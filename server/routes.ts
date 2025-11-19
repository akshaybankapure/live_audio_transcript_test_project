import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { db } from "./db";
import { transcripts } from "@shared/schema";
import { eq } from "drizzle-orm";
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
import { buildUserScopedKey, serverCache, setPrivateCacheHeaders } from "./cache";
import { log } from "./vite";

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
        log(`Created new device: ${user.displayName}`, "DeviceAuth");
      } else {
        log(`Existing device: ${user.displayName}`, "DeviceAuth");
      }

      // Store device user in session
      req.session.deviceUserId = user.id;
      req.session.save((err: any) => {
        if (err) {
          console.error("Error saving session:", err);
          return res.status(500).json({ error: "Failed to save session" });
        }
        log(`Session saved for user ${user.id}, session ID: ${req.sessionID}`, "DeviceAuth");
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
        log(`Admin logged in: ${adminUser.displayName}`, "AdminAuth");
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
      const cacheKey = buildUserScopedKey(userId, '/api/auth/user');
      const cached = serverCache.get<any>(cacheKey);
      if (cached) {
        setPrivateCacheHeaders(res, 30, 60);
        return res.json(cached);
      }
      const user = await storage.getUser(userId);
      setPrivateCacheHeaders(res, 30, 60);
      serverCache.set(cacheKey, user, 30_000);
      return res.json(user);
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
      log(`Created temporary API key, expires at: ${data.expires_at}`, "TempKey");
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

      log(`Live Recording saved with ID: ${savedTranscript.id}, ${profanityDetection.flaggedItems.length} flagged items`, "LiveRecording");

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

      log(`Draft Transcript created ID: ${transcript.id}`, "DraftTranscript");
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
      const deviceUser = await storage.getUser(userId);

      // Collect all flags first (batch processing for performance)
      const allProfanityFlags: any[] = [];
      const allLanguageFlags: any[] = [];
      
      // Process each new segment individually for REAL-TIME flagging only
      // NOTE: Only profanity and language policy are flagged in real-time
      // Topic adherence and participation are analyzed only at session end
      for (const segment of recentSegments) {
        const analysis = analyzeSegment(segment, id, allowedLanguage);

        // Collect profanity flags (batch insert later)
        for (const flagged of analysis.profanity) {
          allProfanityFlags.push(flagged);
          totalNewFlags++;
          profanityCount++;
          
          // Broadcast real-time alert immediately (non-blocking)
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

        // Collect language policy violations (batch insert later)
        for (const violation of analysis.languagePolicy) {
          allLanguageFlags.push(violation);
          totalNewFlags++;
          languagePolicyCount++;
          
          // Broadcast real-time alert immediately (non-blocking)
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

        // Topic adherence and participation are NOT analyzed in real-time
        // They require full conversation context and are analyzed only when session is completed
      }

      // Batch insert all flagged content in parallel (much faster than sequential)
      const flagInsertPromises: Promise<any>[] = [];
      for (const flagged of [...allProfanityFlags, ...allLanguageFlags]) {
        flagInsertPromises.push(storage.createFlaggedContent(flagged));
      }
      
      // Update counts in parallel with flag inserts
      const updatePromises: Promise<any>[] = [];
      if (profanityCount > 0) {
        updatePromises.push(storage.updateProfanityCount(id, profanityCount));
      }
      if (languagePolicyCount > 0) {
        updatePromises.push(storage.updateLanguagePolicyViolations(id, languagePolicyCount));
      }
      
      // Wait for all database operations in parallel
      await Promise.all([...flagInsertPromises, ...updatePromises]);

      log(`Transcript ${id}: appended ${newSegments.length} segments, ${totalNewFlags} new flags (${profanityCount} profanity, ${languagePolicyCount} language). Topic adherence and participation will be analyzed at session end.`, "AppendSegments");

      // Invalidate caches so flags appear immediately
      // Invalidate transcript cache (includes flaggedContent)
      serverCache.invalidate(`user:${userId}|path:/api/transcripts/${id}`);
      // Invalidate dashboard cache when segments are appended (so draft transcripts show up)
      // Invalidate both user-scoped and device-scoped cache keys
      serverCache.invalidatePrefix(`user:${userId}|path:/api/dashboard`);
      serverCache.invalidatePrefix(`device:${userId}|path:/api/dashboard`);
      // Also invalidate the specific device dashboard cache
      serverCache.invalidate(`device:${userId}|path:/api/dashboard/device`);
      // Invalidate flagged content cache
      serverCache.invalidate(`user:${userId}|path:/api/flagged-content`);
      log(`Invalidated caches for user ${userId} after appending segments and flags`, "AppendSegments");

      // Return updated transcript directly (no need to fetch again)
      res.json({
        ...updated,
        newFlaggedItems: [...allProfanityFlags, ...allLanguageFlags],
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

  // Quick report endpoint for frontend profanity detection
  app.post("/api/transcripts/:id/quick-report", isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const { segments } = req.body;
      const userId = req.user.claims.sub;

      // Verify user owns this transcript
      const existing = await storage.getTranscript(id);
      if (!existing) {
        return res.status(404).json({ error: "Transcript not found" });
      }
      if (existing.userId !== userId) {
        return res.status(403).json({ error: "Access denied" });
      }

      if (!segments || !Array.isArray(segments)) {
        return res.status(400).json({ error: "segments array is required" });
      }

      // Create flags for profanity detected in frontend
      let reportedCount = 0;
      for (const segment of segments) {
        // Use server-side profanity detection to create proper flags
        const profanityResult = detectProfanity([{
          text: segment.text,
          startTime: segment.startTime,
          endTime: segment.endTime,
          speaker: segment.speaker,
        }], id);
        
        for (const flagged of profanityResult.flaggedItems) {
          await storage.createFlaggedContent(flagged);
          reportedCount++;
        }
      }

      // Update profanity count
      if (reportedCount > 0) {
        await storage.updateProfanityCount(id, reportedCount);
      }

      res.json({ reported: reportedCount });
    } catch (error) {
      console.error("Error in quick report:", error);
      res.status(500).json({ error: "Failed to report profanity" });
    }
  });

  // Progressive saving: Mark transcript as complete
  app.patch("/api/transcripts/:id/complete", isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const { duration, audioFileUrl, sonioxTranscriptionId } = req.body;
      const userId = req.user.claims.sub;

      // Verify user owns this transcript
      const existing = await storage.getTranscript(id);
      if (!existing) {
        return res.status(404).json({ error: "Transcript not found" });
      }
      if (existing.userId !== userId) {
        return res.status(403).json({ error: "Access denied" });
      }

      let fetchedFromSoniox = false;
      let finalSegments = existing.segments as any[];

      // If Soniox transcription ID is provided, fetch the final transcript from Soniox
      // This replaces our accumulated segments with Soniox's accurate final transcript
      if (sonioxTranscriptionId && SONIOX_API_KEY) {
        try {
          log(`Fetching final transcript from Soniox for transcription ID: ${sonioxTranscriptionId}`, "Complete Transcript");
          
          // Wait a bit for Soniox to finalize the transcript
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          const transcriptResponse = await fetch(
            `https://api.soniox.com/v1/transcriptions/${sonioxTranscriptionId}/transcript`,
            {
              headers: {
                Authorization: `Bearer ${SONIOX_API_KEY}`,
              },
            }
          );

          if (transcriptResponse.ok) {
            const transcriptData = await transcriptResponse.json();
            
            // Parse Soniox's final transcript (more accurate than our accumulated segments)
            finalSegments = parseTranscript(transcriptData);
            const languages = extractLanguages(transcriptData);
            const finalDuration = calculateDuration(transcriptData);
            
            // Update transcript with Soniox's final segments and store Soniox job ID
            await db
              .update(transcripts)
              .set({
                segments: finalSegments as any,
                sonioxJobId: sonioxTranscriptionId,
                language: languages[0] || existing.language,
                duration: finalDuration || duration,
                updatedAt: new Date(),
              })
              .where(eq(transcripts.id, id));
            
            fetchedFromSoniox = true;
            log(`Replaced transcript segments with Soniox final transcript: ${finalSegments.length} segments`, "Complete Transcript");
            
            // When Soniox final transcript replaces accumulated segments, delete ALL old flags
            // This prevents duplicates and ensures flags match the final transcript text/timestamps
            const deletedFlagsCount = await storage.deleteAllFlags(id);
            if (deletedFlagsCount > 0) {
              log(`[Complete Transcript] ID: ${id}: Deleted ${deletedFlagsCount} old flags before recreating from final transcript`, "Complete Transcript");
            }
          } else {
            log(`Failed to fetch Soniox transcript: ${transcriptResponse.status}`, "Complete Transcript");
          }
        } catch (error) {
          console.error("Error fetching Soniox final transcript:", error);
          log(`Error fetching Soniox final transcript, using accumulated segments`, "Complete Transcript");
        }
      }

      // Run comprehensive analysis on complete transcript (using final segments from Soniox if fetched)
      if (finalSegments.length > 0) {
        // Get topic and participation configs from transcript
        const topicConfig = existing.topicKeywords || existing.topicPrompt ? {
          topicKeywords: existing.topicKeywords as string[] | undefined,
          topicPrompt: existing.topicPrompt as string | undefined,
        } : undefined;
        
        const participationConfig = existing.participationConfig as { dominanceThreshold?: number; silenceThreshold?: number } | undefined;
        
        const analysis = await analyzeContent(
          finalSegments, 
          id, 
          process.env.ALLOWED_LANGUAGE || 'en',
          topicConfig,
          participationConfig
        );
        
        // If we didn't fetch from Soniox, only clean up participation flags
        // (profanity/language flags from progressive saving are still valid)
        if (!fetchedFromSoniox) {
          const deletedCount = await storage.deleteParticipationFlags(id);
          if (deletedCount > 0) {
            console.log(`[Complete Transcript] ID: ${id}: Cleaned up ${deletedCount} old participation flags`);
          }
        }

        // Save all flagged content from comprehensive analysis
        // This includes off-topic segments and participation flags created at session end
        for (const flagged of analysis.allFlaggedItems) {
          await storage.createFlaggedContent(flagged);
        }

        // Update participation balance and topic adherence (calculated at session end)
        await storage.updateParticipationBalance(id, analysis.participation);
        await storage.updateTopicAdherence(id, analysis.topicAdherence.score);

        // Broadcast participation/topic alerts if needed (non-real-time signals, only at session end)
        const deviceUser = await storage.getUser(userId);
        
        // Broadcast participation imbalance alert if detected
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

        // Broadcast topic adherence alert if score is low
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
        
        console.log(`[Complete Transcript] ID: ${id}: Final analysis - ${analysis.allFlaggedItems.length} total flags, participation balanced: ${analysis.participation.isBalanced}, topic adherence: ${(analysis.topicAdherence.score * 100).toFixed(0)}%`);

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
          finalSegments,
          id,
          analysis.allFlaggedItems,
          duration || 0,
          process.env.ALLOWED_LANGUAGE || 'en'
        );
      }

      // Update transcript status and duration (if not already updated by Soniox fetch)
      let updated: Transcript;
      if (!fetchedFromSoniox) {
        updated = await storage.completeTranscript(id, { duration, audioFileUrl });
        console.log(`[Complete Transcript] ID: ${id}, status: complete`);
      } else {
        // Transcript was already updated with Soniox data, just mark as complete
        updated = await storage.completeTranscript(id, { duration: duration || existing.duration, audioFileUrl });
        console.log(`[Complete Transcript] ID: ${id}, status: complete (using Soniox final transcript)`);
      }

      // Invalidate dashboard cache for this user to ensure new transcript appears immediately
      const cacheKeysToInvalidate = [
        buildUserScopedKey(userId, '/api/dashboard/overview'),
        `device:${userId}|path:/api/dashboard/device`,
      ];
      
      // Invalidate all time range variations
      const timeRanges = ['live', '1h', '12h', 'today', 'all'];
      for (const timeRange of timeRanges) {
        cacheKeysToInvalidate.push(
          buildUserScopedKey(userId, '/api/dashboard/overview', { timeRange })
        );
      }
      
      for (const key of cacheKeysToInvalidate) {
        serverCache.invalidate(key);
      }
      
      // Also invalidate by prefix to catch any variations
      serverCache.invalidatePrefix(`user:${userId}|path:/api/dashboard`);
      serverCache.invalidatePrefix(`device:${userId}|path:/api/dashboard`);
      
      log(`Invalidated dashboard cache for user ${userId} after completing transcript ${id}`, "Complete Transcript");

      res.json({ ...updated, fetchedFromSoniox, segmentCount: finalSegments.length });
    } catch (error) {
      console.error("Error completing transcript:", error);
      res.status(500).json({ error: "Failed to complete transcript" });
    }
  });

  // Get user's transcripts
  app.get("/api/transcripts", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const cacheKey = buildUserScopedKey(userId, '/api/transcripts');
      const cached = serverCache.get<any>(cacheKey);
      if (cached) {
        setPrivateCacheHeaders(res, 60, 120);
        return res.json(cached);
      }
      const transcripts = await storage.getUserTranscripts(userId);
      setPrivateCacheHeaders(res, 60, 120);
      serverCache.set(cacheKey, transcripts, 60_000);
      return res.json(transcripts);
    } catch (error) {
      console.error("Error fetching transcripts:", error);
      res.status(500).json({ error: "Failed to fetch transcripts" });
    }
  });

  // Get all flagged content for user (for dashboard)
  app.get("/api/flagged-content", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const cacheKey = buildUserScopedKey(userId, '/api/flagged-content');
      const cached = serverCache.get<any>(cacheKey);
      if (cached) {
        setPrivateCacheHeaders(res, 60, 120);
        return res.json(cached);
      }
      const flaggedContent = await storage.getUserFlaggedContent(userId);
      setPrivateCacheHeaders(res, 60, 120);
      serverCache.set(cacheKey, flaggedContent, 60_000);
      return res.json(flaggedContent);
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
      
      const queryOpts = {
        timeRange: timeRange as 'live' | 'all' | 'custom' | '1h' | '12h' | 'today' | 'session',
        startDate,
        endDate,
        transcriptId,
      };

      const cacheKey = buildUserScopedKey(currentUserId, '/api/dashboard/overview', {
        timeRange,
        startDate: startDate?.toISOString(),
        endDate: endDate?.toISOString(),
        transcriptId,
      });
      const cached = serverCache.get<any>(cacheKey);
      if (cached) {
        setPrivateCacheHeaders(res, 60, 120);
        return res.json({ devices: cached, currentUserId });
      }
      const overview = await storage.getDashboardOverview(queryOpts);
      
      // Add cache headers for better performance
      setPrivateCacheHeaders(res, 60, 120);
      serverCache.set(cacheKey, overview, 60_000);
      return res.json({ devices: overview, currentUserId });
    } catch (error) {
      console.error("Error fetching dashboard overview:", error);
      res.status(500).json({ error: "Failed to fetch dashboard overview" });
    }
  });

  // Dashboard: Get detailed data for a specific device/group
  app.get("/api/dashboard/device/:deviceId", isAuthenticated, async (req: any, res) => {
    try {
      const { deviceId } = req.params;
      const { refreshFromSoniox } = req.query; // Optional: force refresh from Soniox
      const cacheKey = `device:${deviceId}|path:/api/dashboard/device`;
      
      // If not forcing refresh, check cache
      if (!refreshFromSoniox) {
        const cached = serverCache.get<any>(cacheKey);
        if (cached) {
          setPrivateCacheHeaders(res, 60, 120);
          return res.json(cached);
        }
      }
      
      const deviceData = await storage.getDeviceDashboard(deviceId);
      
      if (!deviceData) {
        return res.status(404).json({ error: "Device not found" });
      }

      // For each session with a Soniox job ID, fetch the full transcript if needed
      if (SONIOX_API_KEY) {
        for (const session of deviceData.sessions) {
          if (session.sonioxJobId) {
            const segments = Array.isArray(session.segments) ? session.segments : (typeof session.segments === 'string' ? JSON.parse(session.segments || '[]') : []);
            
            // Check if segments seem incomplete:
            // 1. No segments at all
            // 2. Segments with very short text (likely incomplete)
            // 3. Total text length is suspiciously short for the duration
            // 4. For completed sessions, always prefer Soniox's final transcript
            const totalTextLength = segments.reduce((sum: number, seg: any) => sum + (seg.text?.length || 0), 0);
            const durationMinutes = session.duration ? session.duration / 60 : 0;
            const expectedMinTextLength = durationMinutes * 50; // Rough estimate: ~50 chars per minute of speech
            
            const hasIncompleteSegments = segments.length === 0 || 
              segments.some((seg: any) => !seg.text || seg.text.trim().length < 10) ||
              (durationMinutes > 1 && totalTextLength < expectedMinTextLength * 0.3); // Less than 30% of expected text
            
            // Fetch from Soniox if:
            // 1. User explicitly requested refresh
            // 2. Segments seem incomplete (empty, very short, or suspiciously short for duration)
            const shouldFetch = refreshFromSoniox || hasIncompleteSegments;
            
            if (shouldFetch) {
              try {
                log(`Fetching full transcript from Soniox for session ${session.id} (Soniox ID: ${session.sonioxJobId})`, "DeviceDashboard");
                
                const transcriptResponse = await fetch(
                  `https://api.soniox.com/v1/transcriptions/${session.sonioxJobId}/transcript`,
                  {
                    headers: {
                      Authorization: `Bearer ${SONIOX_API_KEY}`,
                    },
                  }
                );

                if (transcriptResponse.ok) {
                  const transcriptData = await transcriptResponse.json();
                  const fullSegments = parseTranscript(transcriptData);
                  
                  // Update the session's segments with full transcript
                  session.segments = fullSegments;
                  
                  // Also update in database for future requests
                  await db
                    .update(transcripts)
                    .set({
                      segments: fullSegments as any,
                      updatedAt: new Date(),
                    })
                    .where(eq(transcripts.id, session.id));
                  
                  log(`Updated session ${session.id} with full Soniox transcript: ${fullSegments.length} segments`, "DeviceDashboard");
                }
              } catch (error) {
                console.error(`Error fetching Soniox transcript for session ${session.id}:`, error);
                // Continue with existing segments if fetch fails
              }
            }
          }
        }
      }

      log(`Device dashboard for ${deviceId}: ${deviceData.sessions.length} sessions (draft: ${deviceData.sessions.filter(s => s.status === 'draft').length}, complete: ${deviceData.sessions.filter(s => s.status === 'complete').length})`, "DeviceDashboard");

      setPrivateCacheHeaders(res, 60, 120);
      serverCache.set(cacheKey, deviceData, 60_000);
      return res.json(deviceData);
    } catch (error) {
      console.error("Error fetching device dashboard:", error);
      res.status(500).json({ error: "Failed to fetch device dashboard" });
    }
  });

  // Admin monitoring: Get dashboard stats for all devices
  app.get("/api/dashboard/stats", requireAdmin, async (req: any, res) => {
    try {
      const cacheKey = `admin:stats|path:/api/dashboard/stats`;
      const cached = serverCache.get<any>(cacheKey);
      if (cached) {
        setPrivateCacheHeaders(res, 30, 60);
        return res.json(cached);
      }
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

      const payload = {
        devices,
        totalDevices,
        totalSessions,
        totalProfanity,
      };
      setPrivateCacheHeaders(res, 30, 60);
      serverCache.set(cacheKey, payload, 30_000);
      return res.json(payload);
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
      const cacheKey = buildUserScopedKey(userId, `/api/transcripts/${id}`);
      const cached = serverCache.get<any>(cacheKey);
      if (cached) {
        setPrivateCacheHeaders(res, 60, 120);
        return res.json(cached);
      }
      
      const transcript = await storage.getTranscript(id);
      if (!transcript) {
        return res.status(404).json({ error: "Transcript not found" });
      }

      // Verify user owns this transcript
      if (transcript.userId !== userId) {
        return res.status(403).json({ error: "Access denied" });
      }

      const flaggedContent = await storage.getTranscriptFlaggedContent(id);
      const payload = {
        ...transcript,
        flaggedContent,
      };
      setPrivateCacheHeaders(res, 60, 120);
      serverCache.set(cacheKey, payload, 60_000);
      return res.json(payload);
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

      // Start new segment - ensure we use currentText which accumulates properly
      currentSpeaker = speakerLabel;
      currentText = text || "";
      currentStartTime = startMs / 1000;
      currentLanguage = language;
      currentSegment = {
        speaker: speakerLabel,
        text: currentText, // Use currentText instead of just text
        startTime: startMs / 1000,
        endTime: endMs / 1000,
        language: getLanguageName(language),
      };
    } else {
      // Continue current segment - tokens may or may not include spaces, so add text directly
      // Soniox tokens typically include leading spaces when needed
      currentText += text || "";
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
