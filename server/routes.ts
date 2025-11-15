import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, isAuthenticated } from "./auth";
import {
  ObjectStorageService,
  ObjectNotFoundError,
} from "./objectStorage";
import { detectProfanity } from "./profanityDetector";
import { analyzeContent, analyzeSegment } from "./contentAnalyzer";
import { qualityLogger } from "./qualityLogger";
import { websocketService } from "./websocketService";
import { requireAdmin } from "./middleware/requireAdmin";
import multer from "multer";
import fs from "fs";
import crypto from "crypto";

const upload = multer({ dest: "uploads/" });

export async function registerRoutes(app: Express): Promise<Server> {
  const SONIOX_API_KEY = process.env.SONIOX_API_KEY;

  if (!SONIOX_API_KEY) {
    console.warn("Warning: SONIOX_API_KEY not found in environment variables");
  }

  // Setup authentication
  await setupAuth(app);

  // Device authentication endpoint (development only)
  app.post('/api/auth/device', async (req: any, res) => {
    try {
      // Only allow in development
      if (process.env.NODE_ENV !== 'development') {
        return res.status(403).json({ error: "Device auth only available in development" });
      }

      const { deviceId } = req.body;
      if (!deviceId) {
        return res.status(400).json({ error: "deviceId is required" });
      }

      // Hash the device ID for privacy
      const hashedDeviceId = crypto
        .createHash('sha256')
        .update(deviceId)
        .digest('hex');

      // Check if device exists
      let user = await storage.findDeviceByHash(hashedDeviceId);

      // If not, create new device
      if (!user) {
        user = await storage.allocateDevice(hashedDeviceId);
        console.log(`[DeviceAuth] Created new device: ${user.displayName}`);
      } else {
        console.log(`[DeviceAuth] Existing device: ${user.displayName}`);
      }

      // Store device user in session
      req.session.deviceUserId = user.id;
      req.session.save((err: any) => {
        if (err) {
          console.error("Error saving session:", err);
          return res.status(500).json({ error: "Failed to save session" });
        }
        res.json(user);
      });
    } catch (error) {
      console.error("Error in device auth:", error);
      res.status(500).json({ error: "Failed to authenticate device" });
    }
  });

  // Admin login endpoint (development only - for testing)
  app.post('/api/auth/admin', async (req: any, res) => {
    try {
      // Only allow in development
      if (process.env.NODE_ENV !== 'development') {
        return res.status(403).json({ error: "Admin login only available in development" });
      }

      // Get the seeded admin user
      const adminUser = await storage.getUserByEmail('admin@local.dev');
      
      if (!adminUser) {
        return res.status(404).json({ error: "Admin user not found" });
      }

      // Store admin user in session
      req.session.deviceUserId = adminUser.id;
      req.session.save((err: any) => {
        if (err) {
          console.error("Error saving session:", err);
          return res.status(500).json({ error: "Failed to save session" });
        }
        console.log(`[AdminAuth] Admin logged in: ${adminUser.displayName}`);
        res.json(adminUser);
      });
    } catch (error) {
      console.error("Error in admin auth:", error);
      res.status(500).json({ error: "Failed to authenticate as admin" });
    }
  });

  // Auth user endpoint
  app.get('/api/auth/user', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      res.json(user);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // Endpoint to provide temporary API key for client-side use
  app.post("/api/get-temp-api-key", async (req, res) => {
    try {
      if (!SONIOX_API_KEY) {
        return res.status(500).json({ error: "Soniox API key not configured" });
      }

      // Create a temporary API key using Soniox's API
      const response = await fetch(
        "https://api.soniox.com/v1/auth/temporary-api-key",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${SONIOX_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            usage_type: "transcribe_websocket",
            expires_in_seconds: 3600, // 1 hour
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Failed to create temporary API key:", errorText);
        return res.status(500).json({ error: "Failed to create temporary API key" });
      }

      const data = await response.json();
      console.log(`[TempKey] Created temporary API key, expires at: ${data.expires_at}`);
      res.json({ apiKey: data.api_key });
    } catch (error) {
      console.error("Error getting temporary API key:", error);
      res.status(500).json({ error: "Failed to get API key" });
    }
  });

  // Object storage endpoints
  app.post("/api/objects/upload", isAuthenticated, async (req, res) => {
    const objectStorageService = new ObjectStorageService();
    const { uploadURL, objectPath } = await objectStorageService.getObjectEntityUploadURL();
    res.json({ uploadURL, objectPath });
  });

  // Save uploaded audio file with ACL policy
  app.post("/api/save-audio", isAuthenticated, async (req: any, res) => {
    try {
      const { objectPath } = req.body;
      const userId = req.user.claims.sub;

      if (!objectPath) {
        return res.status(400).json({ error: "objectPath is required" });
      }

      const objectStorageService = new ObjectStorageService();
      await objectStorageService.trySetObjectEntityAclPolicy(
        objectPath,
        {
          owner: userId,
          visibility: "private",
        },
      );

      res.json({ objectPath });
    } catch (error) {
      console.error("Error saving audio file:", error);
      res.status(500).json({ error: "Failed to save audio file" });
    }
  });

  app.get("/objects/:objectPath(*)", isAuthenticated, async (req: any, res) => {
    const userId = req.user?.claims?.sub;
    const objectStorageService = new ObjectStorageService();
    try {
      const objectFile = await objectStorageService.getObjectEntityFile(
        req.path,
      );
      const canAccess = await objectStorageService.canAccessObjectEntity({
        objectFile,
        userId: userId,
      });
      if (!canAccess) {
        return res.sendStatus(401);
      }
      objectStorageService.downloadObject(objectFile, res);
    } catch (error) {
      console.error("Error checking object access:", error);
      if (error instanceof ObjectNotFoundError) {
        return res.sendStatus(404);
      }
      return res.sendStatus(500);
    }
  });

  // Save live recording with transcript and profanity detection (legacy - for backward compatibility)
  app.post("/api/save-live-transcript", isAuthenticated, async (req: any, res) => {
    try {
      const { title, audioFileUrl, duration, language, segments } = req.body;
      const userId = req.user.claims.sub;

      if (!segments || segments.length === 0) {
        return res.status(400).json({ error: "segments are required" });
      }

      // Save transcript to database (let DB generate ID)
      const savedTranscript = await storage.createTranscript({
        userId,
        title: title || `Live Recording ${new Date().toLocaleString()}`,
        audioFileUrl: audioFileUrl || null,
        duration: duration || 0,
        source: 'live',
        language: language || 'en',
        segments,
        status: 'complete', // Mark as complete for legacy endpoint
      });

      // Detect profanity in segments using the generated transcript ID
      const profanityDetection = detectProfanity(segments, savedTranscript.id);

      // Save flagged content
      if (profanityDetection.hasProfanity) {
        for (const flagged of profanityDetection.flaggedItems) {
          await storage.createFlaggedContent(flagged);
        }
      }

      console.log(`[Live Recording] Saved with ID: ${savedTranscript.id}, ${profanityDetection.flaggedItems.length} flagged items`);

      res.json({
        ...savedTranscript,
        flaggedContent: profanityDetection.flaggedItems,
      });
    } catch (error) {
      console.error("Error saving live transcript:", error);
      res.status(500).json({ error: "Failed to save live transcript" });
    }
  });

  // Progressive saving: Create draft transcript
  app.post("/api/transcripts", isAuthenticated, async (req: any, res) => {
    try {
      const { title, language, topicPrompt, topicKeywords, participationConfig } = req.body;
      const userId = req.user.claims.sub;

      const transcript = await storage.createTranscript({
        userId,
        title: title || `Live Recording ${new Date().toLocaleString()}`,
        source: 'live',
        language: language || 'en',
        segments: [], // Start with empty segments
        status: 'draft',
        topicPrompt: topicPrompt || null,
        topicKeywords: topicKeywords || null,
        participationConfig: participationConfig || null,
      });

      console.log(`[Draft Transcript] Created ID: ${transcript.id}`);
      res.json(transcript);
    } catch (error) {
      console.error("Error creating draft transcript:", error);
      res.status(500).json({ error: "Failed to create transcript" });
    }
  });

  // Progressive saving: Append segments to transcript
  app.patch("/api/transcripts/:id/segments", isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const { segments: newSegments, fromIndex } = req.body;
      const userId = req.user.claims.sub;

      if (!newSegments || !Array.isArray(newSegments) || newSegments.length === 0) {
        return res.status(400).json({ error: "segments array is required" });
      }

      if (typeof fromIndex !== 'number') {
        return res.status(400).json({ error: "fromIndex is required" });
      }

      // Verify user owns this transcript
      const existing = await storage.getTranscript(id);
      if (!existing) {
        return res.status(404).json({ error: "Transcript not found" });
      }
      if (existing.userId !== userId) {
        return res.status(403).json({ error: "Access denied" });
      }

      // Append segments with index validation
      const updated = await storage.appendSegments(id, newSegments, fromIndex);

      // Get all segments for comprehensive analysis
      const allSegments = updated.segments as any[];
      const recentSegments = allSegments.slice(fromIndex);

      // Process each segment individually for real-time flagging
      // This ensures flagging happens immediately, not waiting for speaker to finish
      const allowedLanguage = process.env.ALLOWED_LANGUAGE || 'en';
      
      // Get topic and participation configs from transcript
      const topicConfig = existing.topicKeywords || existing.topicPrompt ? {
        topicKeywords: existing.topicKeywords as string[] | undefined,
        topicPrompt: existing.topicPrompt as string | undefined,
      } : undefined;
      
      const participationConfig = existing.participationConfig as { dominanceThreshold?: number; silenceThreshold?: number } | undefined;
      
      let totalNewFlags = 0;
      let profanityCount = 0;
      let languagePolicyCount = 0;
      let offTopicCount = 0;
      const deviceUser = await storage.getUser(userId);

      // Process each new segment individually
      // Pass all segments for participation analysis
      for (const segment of recentSegments) {
        const analysis = analyzeSegment(segment, id, allowedLanguage, allSegments, topicConfig, participationConfig);

        // Handle profanity flags (separate flag type)
        for (const flagged of analysis.profanity) {
          await storage.createFlaggedContent(flagged);
          totalNewFlags++;
          profanityCount++;
          
          // Broadcast real-time alert
          websocketService.broadcastAlert({
            type: 'PROFANITY_ALERT',
            deviceId: userId,
            deviceName: deviceUser?.displayName || 'Unknown Group',
            transcriptId: id,
            flaggedWord: flagged.flaggedWord,
            timestampMs: flagged.timestampMs,
            speaker: flagged.speaker || 'Unknown',
            context: flagged.context || '',
            flagType: 'profanity',
          });
        }

        // Handle language policy violations (separate flag type)
        for (const violation of analysis.languagePolicy) {
          await storage.createFlaggedContent(violation);
          totalNewFlags++;
          languagePolicyCount++;
          
          // Broadcast real-time alert
          websocketService.broadcastAlert({
            type: 'LANGUAGE_POLICY_ALERT',
            deviceId: userId,
            deviceName: deviceUser?.displayName || 'Unknown Group',
            transcriptId: id,
            flaggedWord: violation.flaggedWord, // Detected language
            timestampMs: violation.timestampMs,
            speaker: violation.speaker || 'Unknown',
            context: violation.context || '',
            flagType: 'language_policy',
          });
        }

        // Handle off-topic flags (separate flag type)
        for (const offTopic of analysis.offTopic) {
          await storage.createFlaggedContent(offTopic);
          totalNewFlags++;
          offTopicCount++;
          
          // Broadcast real-time alert
          websocketService.broadcastAlert({
            type: 'TOPIC_ADHERENCE_ALERT',
            deviceId: userId,
            deviceName: deviceUser?.displayName || 'Unknown Group',
            transcriptId: id,
            flaggedWord: offTopic.flaggedWord,
            timestampMs: offTopic.timestampMs,
            speaker: offTopic.speaker || 'Unknown',
            context: offTopic.context || '',
            flagType: 'off_topic',
          });
        }

        // Handle participation flags (separate flag type)
        for (const participation of analysis.participation) {
          await storage.createFlaggedContent(participation);
          totalNewFlags++;
          
          // Broadcast real-time alert
          websocketService.broadcastAlert({
            type: 'PARTICIPATION_ALERT',
            deviceId: userId,
            deviceName: deviceUser?.displayName || 'Unknown Group',
            transcriptId: id,
            flaggedWord: participation.flaggedWord,
            timestampMs: participation.timestampMs,
            speaker: participation.speaker || 'Unknown',
            context: participation.context || '',
            flagType: 'participation',
          });
        }
      }

      // Update counts
      if (profanityCount > 0) {
        await storage.updateProfanityCount(id, profanityCount);
      }
      if (languagePolicyCount > 0) {
        await storage.updateLanguagePolicyViolations(id, languagePolicyCount);
      }

      console.log(`[Append Segments] Transcript ${id}: appended ${newSegments.length} segments, ${totalNewFlags} new flags (${profanityCount} profanity, ${languagePolicyCount} language, ${offTopicCount} off-topic)`);

      // Return updated transcript with current counts
      const final = await storage.getTranscript(id);
      res.json({
        ...final,
        newFlaggedItems: recentSegments.flatMap(segment => {
          const analysis = analyzeSegment(segment, id, allowedLanguage, allSegments, topicConfig, participationConfig);
          return [...analysis.profanity, ...analysis.languagePolicy, ...analysis.offTopic, ...analysis.participation];
        }),
      });
    } catch (error) {
      console.error("Error appending segments:", error);
      if (error instanceof Error && error.message.includes('Index mismatch')) {
        return res.status(409).json({ error: error.message });
      }
      res.status(500).json({ error: "Failed to append segments" });
    }
  });

  // Set topic configuration for a transcript
  app.post("/api/transcripts/:id/topic-config", isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const { topicPrompt, topicKeywords } = req.body;
      const userId = req.user.claims.sub;

      // Verify user owns this transcript
      const existing = await storage.getTranscript(id);
      if (!existing) {
        return res.status(404).json({ error: "Transcript not found" });
      }
      if (existing.userId !== userId) {
        return res.status(403).json({ error: "Access denied" });
      }

      const updated = await storage.updateTopicConfig(id, {
        topicPrompt: topicPrompt || undefined,
        topicKeywords: topicKeywords || undefined,
      });

      res.json(updated);
    } catch (error) {
      console.error("Error updating topic config:", error);
      res.status(500).json({ error: "Failed to update topic config" });
    }
  });

  // Set participation configuration for a transcript
  app.post("/api/transcripts/:id/participation-config", isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const { dominanceThreshold, silenceThreshold } = req.body;
      const userId = req.user.claims.sub;

      // Verify user owns this transcript
      const existing = await storage.getTranscript(id);
      if (!existing) {
        return res.status(404).json({ error: "Transcript not found" });
      }
      if (existing.userId !== userId) {
        return res.status(403).json({ error: "Access denied" });
      }

      const updated = await storage.updateParticipationConfig(id, {
        dominanceThreshold: dominanceThreshold !== undefined ? dominanceThreshold : undefined,
        silenceThreshold: silenceThreshold !== undefined ? silenceThreshold : undefined,
      });

      res.json(updated);
    } catch (error) {
      console.error("Error updating participation config:", error);
      res.status(500).json({ error: "Failed to update participation config" });
    }
  });

  // Progressive saving: Mark transcript as complete
  app.patch("/api/transcripts/:id/complete", isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const { duration, audioFileUrl } = req.body;
      const userId = req.user.claims.sub;

      // Verify user owns this transcript
      const existing = await storage.getTranscript(id);
      if (!existing) {
        return res.status(404).json({ error: "Transcript not found" });
      }
      if (existing.userId !== userId) {
        return res.status(403).json({ error: "Access denied" });
      }

      // Run comprehensive analysis on complete transcript
      const segments = existing.segments as any[];
      if (segments.length > 0) {
        // Get topic and participation configs from transcript
        const topicConfig = existing.topicKeywords || existing.topicPrompt ? {
          topicKeywords: existing.topicKeywords as string[] | undefined,
          topicPrompt: existing.topicPrompt as string | undefined,
        } : undefined;
        
        const participationConfig = existing.participationConfig as { dominanceThreshold?: number; silenceThreshold?: number } | undefined;
        
        const analysis = await analyzeContent(
          segments, 
          id, 
          process.env.ALLOWED_LANGUAGE || 'en',
          topicConfig,
          participationConfig
        );
        
        // Save all flagged content (including off-topic segments)
        for (const flagged of analysis.allFlaggedItems) {
          await storage.createFlaggedContent(flagged);
        }

        // Update participation balance and topic adherence
        await storage.updateParticipationBalance(id, analysis.participation);
        await storage.updateTopicAdherence(id, analysis.topicAdherence.score);

        // Broadcast participation/topic alerts if needed (non-real-time signals)
        const deviceUser = await storage.getUser(userId);
        if (!analysis.participation.isBalanced) {
          websocketService.broadcastAlert({
            type: 'PARTICIPATION_ALERT',
            deviceId: userId,
            deviceName: deviceUser?.displayName || 'Unknown Group',
            transcriptId: id,
            flaggedWord: 'participation_imbalance',
            timestampMs: Math.floor(duration * 1000) || 0,
            speaker: analysis.participation.dominantSpeaker || 'Multiple',
            context: analysis.participation.imbalanceReason || '',
            flagType: 'participation',
          });
        }

        if (analysis.topicAdherence.score < 0.7) {
          websocketService.broadcastAlert({
            type: 'TOPIC_ADHERENCE_ALERT',
            deviceId: userId,
            deviceName: deviceUser?.displayName || 'Unknown Group',
            transcriptId: id,
            flaggedWord: 'low_topic_adherence',
            timestampMs: Math.floor(duration * 1000) || 0,
            speaker: 'Group',
            context: `Topic adherence score: ${(analysis.topicAdherence.score * 100).toFixed(0)}%`,
            flagType: 'off_topic',
          });
        }

        // Log quality metrics
        await qualityLogger.logQualityMetric(id, 'final_analysis', {
          profanityCount: analysis.profanity.flaggedItems.length,
          languageViolations: analysis.languagePolicy.violations.length,
          participationBalance: analysis.participation.isBalanced,
          topicAdherenceScore: analysis.topicAdherence.score,
        });

        // Run quality validation tests
        const { runAllQualityTests } = await import("./qualityTests");
        await runAllQualityTests(
          segments,
          id,
          analysis.allFlaggedItems,
          duration || 0,
          process.env.ALLOWED_LANGUAGE || 'en'
        );
      }

      const updated = await storage.completeTranscript(id, { duration, audioFileUrl });
      console.log(`[Complete Transcript] ID: ${id}, status: complete`);

      res.json(updated);
    } catch (error) {
      console.error("Error completing transcript:", error);
      res.status(500).json({ error: "Failed to complete transcript" });
    }
  });

  // Get user's transcripts
  app.get("/api/transcripts", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const transcripts = await storage.getUserTranscripts(userId);
      res.json(transcripts);
    } catch (error) {
      console.error("Error fetching transcripts:", error);
      res.status(500).json({ error: "Failed to fetch transcripts" });
    }
  });

  // Get all flagged content for user (for dashboard)
  app.get("/api/flagged-content", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const flaggedContent = await storage.getUserFlaggedContent(userId);
      res.json(flaggedContent);
    } catch (error) {
      console.error("Error fetching flagged content:", error);
      res.status(500).json({ error: "Failed to fetch flagged content" });
    }
  });

  // Dashboard: Get overview of all devices/groups with aggregate stats
  app.get("/api/dashboard/overview", isAuthenticated, async (req: any, res) => {
    try {
      const currentUserId = req.user.claims.sub;
      
      // Parse filter parameters from query string
      const timeRange = req.query.timeRange || 'live'; // Default to 'live'
      const startDate = req.query.startDate ? new Date(req.query.startDate) : undefined;
      const endDate = req.query.endDate ? new Date(req.query.endDate) : undefined;
      const transcriptId = req.query.transcriptId || undefined;
      
      const overview = await storage.getDashboardOverview({
        timeRange: timeRange as 'live' | 'all' | 'custom' | '1h' | '12h' | 'today' | 'session',
        startDate,
        endDate,
        transcriptId,
      });
      
      // Add cache headers for better performance (5 minutes)
      res.set({
        'Cache-Control': 'private, max-age=300, stale-while-revalidate=600',
      });
      
      res.json({ devices: overview, currentUserId });
    } catch (error) {
      console.error("Error fetching dashboard overview:", error);
      res.status(500).json({ error: "Failed to fetch dashboard overview" });
    }
  });

  // Dashboard: Get detailed data for a specific device/group
  app.get("/api/dashboard/device/:deviceId", isAuthenticated, async (req: any, res) => {
    try {
      const { deviceId } = req.params;
      const deviceData = await storage.getDeviceDashboard(deviceId);
      
      if (!deviceData) {
        return res.status(404).json({ error: "Device not found" });
      }

      res.json(deviceData);
    } catch (error) {
      console.error("Error fetching device dashboard:", error);
      res.status(500).json({ error: "Failed to fetch device dashboard" });
    }
  });

  // Admin monitoring: Get dashboard stats for all devices
  app.get("/api/dashboard/stats", requireAdmin, async (req: any, res) => {
    try {
      const overview = await storage.getDashboardOverview();
      
      // Calculate aggregate stats
      const totalDevices = overview.length;
      const totalSessions = overview.reduce((sum, device) => sum + device.sessionCount, 0);
      const totalProfanity = overview.reduce((sum, device) => sum + device.flagCount, 0);
      
      // Format device data for monitoring dashboard
      const devices = overview.map(device => ({
        id: device.userId,
        name: device.displayName || 'Unknown Device',
        totalSessions: device.sessionCount,
        totalProfanity: device.flagCount,
      }));

      res.json({
        devices,
        totalDevices,
        totalSessions,
        totalProfanity,
      });
    } catch (error) {
      console.error("Error fetching dashboard stats:", error);
      res.status(500).json({ error: "Failed to fetch dashboard stats" });
    }
  });

  // Get single transcript with flagged content
  app.get("/api/transcripts/:id", isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.claims.sub;
      
      const transcript = await storage.getTranscript(id);
      if (!transcript) {
        return res.status(404).json({ error: "Transcript not found" });
      }

      // Verify user owns this transcript
      if (transcript.userId !== userId) {
        return res.status(403).json({ error: "Access denied" });
      }

      const flaggedContent = await storage.getTranscriptFlaggedContent(id);
      
      res.json({
        ...transcript,
        flaggedContent,
      });
    } catch (error) {
      console.error("Error fetching transcript:", error);
      res.status(500).json({ error: "Failed to fetch transcript" });
    }
  });

  app.post("/api/upload-audio", isAuthenticated, upload.single("audio"), async (req: any, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No audio file provided" });
      }

      if (!SONIOX_API_KEY) {
        return res.status(500).json({ error: "Soniox API key not configured" });
      }

      const filePath = req.file.path;
      const filename = req.file.originalname;
      const selectedLanguage = req.body.language || "en";
      
      console.log(`[Upload] Selected language: ${selectedLanguage}`);

      // Step 1: Upload file to Soniox
      // Read file into buffer and create Web FormData
      const fileBuffer = fs.readFileSync(filePath);
      const blob = new Blob([fileBuffer], { type: req.file.mimetype || "audio/mpeg" });
      const formData = new FormData();
      formData.append("file", blob, filename);

      const uploadResponse = await fetch("https://api.soniox.com/v1/files", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SONIOX_API_KEY}`,
        },
        body: formData,
      });

      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        console.error("Soniox upload error:", errorText);
        fs.unlinkSync(filePath);
        return res.status(500).json({ error: "Failed to upload file to Soniox" });
      }

      const uploadResult = await uploadResponse.json();
      const fileId = uploadResult.id;
      console.log(`[Upload] File uploaded to Soniox, ID: ${fileId}`);

      // Step 2: Create transcription request
      const transcriptionResponse = await fetch(
        "https://api.soniox.com/v1/transcriptions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${SONIOX_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            file_id: fileId,
            model: "stt-async-preview",
            enable_speaker_diarization: true,
            enable_language_identification: selectedLanguage === "auto",
            enable_endpoint_detection: true,
            language_hints: selectedLanguage === "auto" 
              ? ["en", "es", "fr", "de", "pt", "hi", "zh", "ja", "ko"]
              : [selectedLanguage],
          }),
        }
      );

      if (!transcriptionResponse.ok) {
        const errorText = await transcriptionResponse.text();
        console.error("Soniox transcription error:", errorText);
        fs.unlinkSync(filePath);
        return res.status(500).json({ error: "Failed to create transcription" });
      }

      const transcriptionResult = await transcriptionResponse.json();
      const transcriptionId = transcriptionResult.id;
      console.log(`[Upload] Transcription created, ID: ${transcriptionId}`);

      // Clean up local file
      fs.unlinkSync(filePath);

      res.json({
        id: transcriptionId,
        filename,
        status: "processing",
      });
    } catch (error) {
      console.error("Upload error:", error);
      if (req.file?.path) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (e) {
          console.error("Failed to clean up file:", e);
        }
      }
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/transcription/:id", isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.claims.sub;
      console.log(`[Transcription] Polling status for ID: ${id}`);

      if (!SONIOX_API_KEY) {
        return res.status(500).json({ error: "Soniox API key not configured" });
      }

      // Check if transcript already exists in database (by Soniox job ID)
      const existingTranscript = await storage.getTranscriptBySonioxJobId(id);
      if (existingTranscript) {
        // Verify ownership
        if (existingTranscript.userId !== userId) {
          return res.status(403).json({ error: "Access denied" });
        }
        
        const flaggedContent = await storage.getTranscriptFlaggedContent(existingTranscript.id);
        return res.json({
          id,
          status: "completed",
          segments: existingTranscript.segments,
          languages: [existingTranscript.language],
          duration: existingTranscript.duration,
          flaggedContent,
        });
      }

      // Check status from Soniox
      const statusResponse = await fetch(
        `https://api.soniox.com/v1/transcriptions/${id}`,
        {
          headers: {
            Authorization: `Bearer ${SONIOX_API_KEY}`,
          },
        }
      );

      if (!statusResponse.ok) {
        console.error(`[Transcription] Status check failed: ${statusResponse.status}`);
        return res.status(404).json({ error: "Transcription not found" });
      }

      const statusResult = await statusResponse.json();
      const status = statusResult.status;
      console.log(`[Transcription] Status: ${status}`);

      if (status === "completed") {
        // Fetch the transcript
        const transcriptResponse = await fetch(
          `https://api.soniox.com/v1/transcriptions/${id}/transcript`,
          {
            headers: {
              Authorization: `Bearer ${SONIOX_API_KEY}`,
            },
          }
        );

        if (!transcriptResponse.ok) {
          return res.status(500).json({ error: "Failed to fetch transcript" });
        }

        const transcriptData = await transcriptResponse.json();

        // Parse the transcript into segments with speaker diarization
        const segments = parseTranscript(transcriptData);
        const languages = extractLanguages(transcriptData);
        const duration = calculateDuration(transcriptData);

        // Save to database (let DB generate UUID, store Soniox job ID)
        const savedTranscript = await storage.createTranscript({
          userId,
          sonioxJobId: id,
          title: `Transcript ${new Date().toLocaleDateString()}`,
          audioFileUrl: null,
          duration,
          source: 'upload',
          language: languages[0] || 'en',
          segments,
        });

        // Detect profanity using the generated transcript ID
        const profanityDetection = detectProfanity(segments, savedTranscript.id);

        // Save flagged content
        if (profanityDetection.hasProfanity) {
          for (const flagged of profanityDetection.flaggedItems) {
            await storage.createFlaggedContent(flagged);
          }
        }

        console.log(`[Transcription] Saved to database with UUID ${savedTranscript.id}, Soniox job ${id}, ${profanityDetection.flaggedItems.length} flagged items`);

        res.json({
          id,
          status,
          segments,
          languages,
          duration,
          flaggedContent: profanityDetection.flaggedItems,
        });
      } else {
        res.json({
          id,
          status,
          segments: [],
          languages: [],
          duration: 0,
        });
      }
    } catch (error) {
      console.error("Transcription fetch error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  const httpServer = createServer(app);
  
  // Initialize WebSocket service for admin monitoring
  websocketService.initialize(httpServer);
  
  return httpServer;
}

function parseTranscript(transcriptData: any) {
  const segments: any[] = [];
  
  if (!transcriptData.tokens || transcriptData.tokens.length === 0) {
    return segments;
  }

  let currentSegment: any = null;
  let currentSpeaker = "";
  let currentText = "";
  let currentStartTime = 0;
  let currentLanguage = "";

  for (const token of transcriptData.tokens) {
    const speaker = token.speaker || "SPEAKER 1";
    const text = token.text || "";
    const startMs = token.start_ms || 0;
    const endMs = token.end_ms || 0;
    const language = token.language || "en";

    // Normalize speaker format
    const speakerLabel = speaker.startsWith("SPEAKER") 
      ? speaker 
      : `SPEAKER ${speaker}`;

    if (currentSpeaker !== speakerLabel) {
      // Save previous segment
      if (currentSegment) {
        segments.push(currentSegment);
      }

      // Start new segment
      currentSpeaker = speakerLabel;
      currentText = text;
      currentStartTime = startMs / 1000;
      currentLanguage = language;
      currentSegment = {
        speaker: speakerLabel,
        text: text,
        startTime: startMs / 1000,
        endTime: endMs / 1000,
        language: getLanguageName(language),
      };
    } else {
      // Continue current segment - tokens already include spaces
      currentText += text;
      currentSegment.text = currentText;
      currentSegment.endTime = endMs / 1000;
    }
  }

  // Add final segment
  if (currentSegment) {
    segments.push(currentSegment);
  }

  return segments;
}

function extractLanguages(transcriptData: any): string[] {
  const languages = new Set<string>();
  
  if (transcriptData.tokens) {
    for (const token of transcriptData.tokens) {
      if (token.language) {
        languages.add(getLanguageName(token.language));
      }
    }
  }

  return Array.from(languages);
}

function getLanguageName(code: string): string {
  const languageMap: Record<string, string> = {
    en: "English",
    es: "Spanish",
    fr: "French",
    de: "German",
    it: "Italian",
    pt: "Portuguese",
    ru: "Russian",
    ja: "Japanese",
    ko: "Korean",
    zh: "Chinese",
    ar: "Arabic",
    hi: "Hindi",
    fa: "Persian",
  };

  return languageMap[code] || code.toUpperCase();
}

function calculateDuration(transcriptData: any): number {
  if (!transcriptData.tokens || transcriptData.tokens.length === 0) {
    return 0;
  }

  const lastToken = transcriptData.tokens[transcriptData.tokens.length - 1];
  return (lastToken.end_ms || 0) / 1000;
}
