var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// shared/schema.ts
var schema_exports = {};
__export(schema_exports, {
  UserRole: () => UserRole,
  deviceIdentifiers: () => deviceIdentifiers,
  flaggedContent: () => flaggedContent,
  insertFlaggedContentSchema: () => insertFlaggedContentSchema,
  insertTranscriptSchema: () => insertTranscriptSchema,
  qualityLogs: () => qualityLogs,
  sessions: () => sessions,
  transcripts: () => transcripts,
  users: () => users
});
import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  varchar,
  timestamp,
  jsonb,
  index,
  integer,
  real
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
var sessions, UserRole, users, deviceIdentifiers, transcripts, insertTranscriptSchema, flaggedContent, insertFlaggedContentSchema, qualityLogs;
var init_schema = __esm({
  "shared/schema.ts"() {
    "use strict";
    sessions = pgTable(
      "sessions",
      {
        sid: varchar("sid").primaryKey(),
        sess: jsonb("sess").notNull(),
        expire: timestamp("expire").notNull()
      },
      (table) => [index("IDX_session_expire").on(table.expire)]
    );
    UserRole = {
      USER: "user",
      ADMIN: "admin"
    };
    users = pgTable("users", {
      id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
      email: varchar("email").unique(),
      firstName: varchar("first_name"),
      lastName: varchar("last_name"),
      profileImageUrl: varchar("profile_image_url"),
      displayName: varchar("display_name"),
      // For devices: Device_01, Device_02, etc.
      role: varchar("role").notNull().default("user"),
      // 'user' or 'admin'
      createdAt: timestamp("created_at").defaultNow(),
      updatedAt: timestamp("updated_at").defaultNow()
    });
    deviceIdentifiers = pgTable("device_identifiers", {
      id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
      hashedDeviceId: varchar("hashed_device_id").notNull().unique(),
      userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
      createdAt: timestamp("created_at").defaultNow()
    });
    transcripts = pgTable(
      "transcripts",
      {
        id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
        userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
        sonioxJobId: varchar("soniox_job_id"),
        // Soniox job ID for uploaded files
        title: varchar("title").notNull(),
        audioFileUrl: varchar("audio_file_url"),
        // URL to the stored audio file (uploaded files)
        sessionAudioObjectPath: varchar("session_audio_object_path"),
        // Object path to full session audio (live recordings)
        duration: real("duration"),
        // Duration in seconds
        source: varchar("source").notNull(),
        // 'upload' or 'live'
        language: varchar("language"),
        segments: jsonb("segments").notNull(),
        // Array of TranscriptSegment
        status: varchar("status").notNull().default("draft"),
        // 'draft' or 'complete'
        lastSegmentIdx: integer("last_segment_idx").notNull().default(0),
        // Cursor for incremental appends
        profanityCount: integer("profanity_count").notNull().default(0),
        // Quick summary for UI
        languagePolicyViolations: integer("language_policy_violations").notNull().default(0),
        // Count of non-allowed language usage
        participationBalance: jsonb("participation_balance"),
        // { speakerId: { talkTime: number, percentage: number } }
        topicAdherenceScore: real("topic_adherence_score"),
        // 0-1 score, null if not calculated yet
        topicPrompt: text("topic_prompt"),
        // The discussion prompt/question for this session
        topicKeywords: jsonb("topic_keywords"),
        // Custom topic keywords array for this session
        participationConfig: jsonb("participation_config"),
        // { dominanceThreshold?: number, silenceThreshold?: number }
        createdAt: timestamp("created_at").defaultNow(),
        updatedAt: timestamp("updated_at").defaultNow()
      },
      (table) => [
        index("IDX_transcripts_user_id").on(table.userId),
        index("IDX_transcripts_created_at").on(table.createdAt),
        index("IDX_transcripts_soniox_job_id").on(table.sonioxJobId)
      ]
    );
    insertTranscriptSchema = createInsertSchema(transcripts).omit({
      id: true,
      createdAt: true,
      updatedAt: true,
      lastSegmentIdx: true,
      profanityCount: true
    });
    flaggedContent = pgTable(
      "flagged_content",
      {
        id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
        transcriptId: varchar("transcript_id").notNull().references(() => transcripts.id, { onDelete: "cascade" }),
        flaggedWord: varchar("flagged_word").notNull(),
        context: text("context"),
        // Surrounding text for context
        timestampMs: integer("timestamp_ms").notNull(),
        // Timestamp in milliseconds
        speaker: varchar("speaker"),
        flagType: varchar("flag_type").notNull().default("profanity"),
        // 'profanity', 'language_policy', 'off_topic'
        snippetObjectPath: varchar("snippet_object_path"),
        // Object path to audio snippet with context
        snippetStartMs: integer("snippet_start_ms"),
        // Start time of snippet in milliseconds
        snippetEndMs: integer("snippet_end_ms"),
        // End time of snippet in milliseconds
        createdAt: timestamp("created_at").defaultNow()
      },
      (table) => [
        index("IDX_flagged_content_transcript_id").on(table.transcriptId),
        index("IDX_flagged_content_created_at").on(table.createdAt)
      ]
    );
    insertFlaggedContentSchema = createInsertSchema(flaggedContent).omit({
      id: true,
      createdAt: true
    });
    qualityLogs = pgTable("quality_logs", {
      id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
      transcriptId: varchar("transcript_id").notNull().references(() => transcripts.id, { onDelete: "cascade" }),
      logType: varchar("log_type").notNull(),
      // 'detection_decision', 'quality_metric', 'alert_triggered'
      metadata: jsonb("metadata").notNull(),
      // Flexible JSON for different log types
      createdAt: timestamp("created_at").defaultNow()
    });
  }
});

// server/db.ts
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
var pool, db;
var init_db = __esm({
  "server/db.ts"() {
    "use strict";
    init_schema();
    neonConfig.webSocketConstructor = ws;
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "DATABASE_URL must be set. Did you forget to provision a database?"
      );
    }
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = drizzle({ client: pool, schema: schema_exports });
  }
});

// server/profanityDetector.ts
import { Filter } from "bad-words";
function detectProfanity(segments, transcriptId) {
  const flaggedItems = [];
  for (const segment of segments) {
    const words = segment.text.split(/\s+/);
    const startTimeMs = segment.startTime * 1e3;
    const durationMs = (segment.endTime - segment.startTime) * 1e3;
    const msPerWord = durationMs / words.length;
    words.forEach((word, index2) => {
      const cleanWord = word.replace(/[^\w]/g, "").toLowerCase();
      if (filter.isProfane(cleanWord)) {
        const wordTimestampMs = Math.floor(startTimeMs + index2 * msPerWord);
        const contextStart = Math.max(0, index2 - 3);
        const contextEnd = Math.min(words.length, index2 + 4);
        const context = words.slice(contextStart, contextEnd).join(" ");
        flaggedItems.push({
          transcriptId,
          flaggedWord: word,
          context,
          timestampMs: wordTimestampMs,
          speaker: segment.speaker,
          flagType: "profanity"
        });
      }
    });
  }
  return {
    hasProfanity: flaggedItems.length > 0,
    flaggedItems
  };
}
var filter, additionalBadWords;
var init_profanityDetector = __esm({
  "server/profanityDetector.ts"() {
    "use strict";
    filter = new Filter();
    additionalBadWords = [
      "crap",
      "damn",
      "hell",
      "bastard",
      "bitch",
      "shit",
      "fuck",
      "asshole",
      "dick",
      "pussy",
      "cock",
      "piss",
      "whore",
      "slut"
    ];
    filter.addWords(...additionalBadWords);
  }
});

// server/languagePolicyDetector.ts
function detectLanguagePolicyViolations(segments, transcriptId, allowedLanguage = ALLOWED_LANGUAGE) {
  const violations = [];
  for (const segment of segments) {
    if (segment.language && segment.language.toLowerCase() !== allowedLanguage.toLowerCase()) {
      const startTimeMs = segment.startTime * 1e3;
      violations.push({
        transcriptId,
        flaggedWord: segment.language,
        // Store detected language as "flagged word"
        context: segment.text.substring(0, 100),
        // First 100 chars for context
        timestampMs: Math.floor(startTimeMs),
        speaker: segment.speaker,
        flagType: "language_policy"
      });
    }
  }
  return {
    hasViolations: violations.length > 0,
    violations
  };
}
var ALLOWED_LANGUAGE;
var init_languagePolicyDetector = __esm({
  "server/languagePolicyDetector.ts"() {
    "use strict";
    ALLOWED_LANGUAGE = process.env.ALLOWED_LANGUAGE || "en";
  }
});

// server/participationAnalyzer.ts
function analyzeParticipationBalance(segments, config) {
  if (segments.length === 0) {
    return {
      speakers: [],
      isBalanced: true,
      silentSpeakers: []
    };
  }
  const speakerStats = /* @__PURE__ */ new Map();
  for (const segment of segments) {
    const speakerId = segment.speaker;
    const duration = segment.endTime - segment.startTime;
    const existing = speakerStats.get(speakerId) || { talkTime: 0, segmentCount: 0 };
    speakerStats.set(speakerId, {
      talkTime: existing.talkTime + duration,
      segmentCount: existing.segmentCount + 1
    });
  }
  const totalTalkTime = Array.from(speakerStats.values()).reduce(
    (sum, stat) => sum + stat.talkTime,
    0
  );
  const speakers = [];
  let dominantSpeaker;
  const silentSpeakers = [];
  const DOMINANCE_THRESHOLD = config?.dominanceThreshold ?? 0.5;
  const SILENCE_THRESHOLD = config?.silenceThreshold ?? 0.05;
  for (const [speakerId, stats] of speakerStats.entries()) {
    const percentage = totalTalkTime > 0 ? stats.talkTime / totalTalkTime : 0;
    speakers.push({
      speakerId,
      talkTime: stats.talkTime,
      segmentCount: stats.segmentCount,
      percentage
    });
    if (percentage > DOMINANCE_THRESHOLD) {
      dominantSpeaker = speakerId;
    }
    if (percentage < SILENCE_THRESHOLD && stats.segmentCount > 0) {
      silentSpeakers.push(speakerId);
    }
  }
  speakers.sort((a, b) => b.percentage - a.percentage);
  const isBalanced = !dominantSpeaker && silentSpeakers.length === 0;
  let imbalanceReason;
  if (dominantSpeaker) {
    const dominant = speakers.find((s) => s.speakerId === dominantSpeaker);
    imbalanceReason = `${dominantSpeaker} dominates with ${(dominant?.percentage || 0) * 100}% of talk time`;
  } else if (silentSpeakers.length > 0) {
    imbalanceReason = `${silentSpeakers.length} speaker(s) are silent or barely participating`;
  }
  return {
    speakers,
    isBalanced,
    dominantSpeaker,
    silentSpeakers,
    imbalanceReason
  };
}
var init_participationAnalyzer = __esm({
  "server/participationAnalyzer.ts"() {
    "use strict";
  }
});

// server/qualityLogger.ts
var QualityLogger, qualityLogger;
var init_qualityLogger = __esm({
  "server/qualityLogger.ts"() {
    "use strict";
    init_db();
    init_schema();
    QualityLogger = class {
      /**
       * Log a detection decision (e.g., why profanity was flagged)
       */
      async logDetectionDecision(transcriptId, decisionType, metadata) {
        try {
          await db.insert(qualityLogs).values({
            transcriptId,
            logType: "detection_decision",
            metadata: {
              decisionType,
              ...metadata,
              timestamp: (/* @__PURE__ */ new Date()).toISOString()
            }
          });
        } catch (error) {
          console.error("[QualityLogger] Failed to log detection decision:", error);
        }
      }
      /**
       * Log quality metrics (e.g., participation balance, topic adherence)
       */
      async logQualityMetric(transcriptId, metricName, metricValue, additionalMetadata) {
        try {
          await db.insert(qualityLogs).values({
            transcriptId,
            logType: "quality_metric",
            metadata: {
              metricName,
              metricValue,
              ...additionalMetadata,
              timestamp: (/* @__PURE__ */ new Date()).toISOString()
            }
          });
        } catch (error) {
          console.error("[QualityLogger] Failed to log quality metric:", error);
        }
      }
      /**
       * Log when an alert is triggered
       */
      async logAlertTriggered(transcriptId, alertType, alertData) {
        try {
          await db.insert(qualityLogs).values({
            transcriptId,
            logType: "alert_triggered",
            metadata: {
              alertType,
              ...alertData,
              timestamp: (/* @__PURE__ */ new Date()).toISOString()
            }
          });
        } catch (error) {
          console.error("[QualityLogger] Failed to log alert:", error);
        }
      }
      /**
       * Log test results for quality validation
       */
      async logTestResult(transcriptId, testName, passed, details) {
        try {
          await db.insert(qualityLogs).values({
            transcriptId,
            logType: "test_result",
            metadata: {
              testName,
              passed,
              ...details,
              timestamp: (/* @__PURE__ */ new Date()).toISOString()
            }
          });
        } catch (error) {
          console.error("[QualityLogger] Failed to log test result:", error);
        }
      }
    };
    qualityLogger = new QualityLogger();
  }
});

// server/qualityTests.ts
var qualityTests_exports = {};
__export(qualityTests_exports, {
  runAllQualityTests: () => runAllQualityTests,
  testAlertSpamPrevention: () => testAlertSpamPrevention,
  testLanguagePolicyDetection: () => testLanguagePolicyDetection,
  testParticipationBalance: () => testParticipationBalance,
  testProfanityDetection: () => testProfanityDetection
});
async function testProfanityDetection(segments, transcriptId) {
  const detection = detectProfanity(segments, transcriptId);
  const falsePositiveWords = ["class", "pass", "assess", "analysis"];
  const hasFalsePositives = detection.flaggedItems.some(
    (item) => falsePositiveWords.some((fp) => item.flaggedWord.toLowerCase().includes(fp))
  );
  const flagsPerSegment = segments.length > 0 ? detection.flaggedItems.length / segments.length : 0;
  const isSpammy = flagsPerSegment > 0.5;
  const passed = !hasFalsePositives && !isSpammy;
  const result = {
    testName: "profanity_detection_accuracy",
    passed,
    details: {
      totalFlags: detection.flaggedItems.length,
      flagsPerSegment,
      hasFalsePositives,
      isSpammy,
      flaggedWords: detection.flaggedItems.map((f) => f.flaggedWord)
    },
    transcriptId
  };
  if (transcriptId) {
    await qualityLogger.logTestResult(transcriptId, result.testName, passed, result.details);
  }
  return result;
}
async function testLanguagePolicyDetection(segments, transcriptId, allowedLanguage = "en") {
  const detection = detectLanguagePolicyViolations(segments, transcriptId, allowedLanguage);
  const hasEnglishFalsePositives = detection.violations.some(
    (v) => v.flaggedWord.toLowerCase() === "english" || v.flaggedWord.toLowerCase() === "en"
  );
  const passed = !hasEnglishFalsePositives;
  const result = {
    testName: "language_policy_detection",
    passed,
    details: {
      totalViolations: detection.violations.length,
      detectedLanguages: Array.from(new Set(detection.violations.map((v) => v.flaggedWord))).sort(),
      hasEnglishFalsePositives
    },
    transcriptId
  };
  if (transcriptId) {
    await qualityLogger.logTestResult(transcriptId, result.testName, passed, result.details);
  }
  return result;
}
async function testParticipationBalance(segments, transcriptId) {
  const analysis = analyzeParticipationBalance(segments);
  const speakerCount = analysis.speakers.length;
  const meaningfulSpeakers = analysis.speakers.filter((s) => s.percentage > 0.1).length;
  const isReasonable = speakerCount >= 2 && meaningfulSpeakers >= 2;
  const hasUnreasonableDominance = analysis.dominantSpeaker && (analysis.speakers.find((s) => s.speakerId === analysis.dominantSpeaker)?.percentage || 0) > 0.7;
  const passed = isReasonable && !hasUnreasonableDominance;
  const result = {
    testName: "participation_balance_reasonableness",
    passed,
    details: {
      speakerCount,
      meaningfulSpeakers,
      isBalanced: analysis.isBalanced,
      dominantSpeaker: analysis.dominantSpeaker,
      silentSpeakers: analysis.silentSpeakers,
      hasUnreasonableDominance
    },
    transcriptId
  };
  if (transcriptId) {
    await qualityLogger.logTestResult(transcriptId, result.testName, passed, result.details);
  }
  return result;
}
async function testAlertSpamPrevention(allFlaggedItems, transcriptId, durationSeconds) {
  const alertsPerMinute = durationSeconds > 0 ? allFlaggedItems.length / durationSeconds * 60 : 0;
  const isSpammy = alertsPerMinute > 5;
  const alertTypes = new Set(allFlaggedItems.map((item) => item.flagType || "profanity"));
  const hasDiversity = alertTypes.size > 1 || allFlaggedItems.length < 3;
  const passed = !isSpammy && hasDiversity;
  const result = {
    testName: "alert_spam_prevention",
    passed,
    details: {
      totalAlerts: allFlaggedItems.length,
      alertsPerMinute: alertsPerMinute.toFixed(2),
      durationSeconds,
      isSpammy,
      alertTypes: Array.from(alertTypes),
      hasDiversity
    },
    transcriptId
  };
  if (transcriptId) {
    await qualityLogger.logTestResult(transcriptId, result.testName, passed, result.details);
  }
  return result;
}
async function runAllQualityTests(segments, transcriptId, allFlaggedItems, durationSeconds, allowedLanguage = "en") {
  const results = await Promise.all([
    testProfanityDetection(segments, transcriptId),
    testLanguagePolicyDetection(segments, transcriptId, allowedLanguage),
    testParticipationBalance(segments, transcriptId),
    testAlertSpamPrevention(allFlaggedItems, transcriptId, durationSeconds)
  ]);
  const passedCount = results.filter((r) => r.passed).length;
  const totalTests = results.length;
  await qualityLogger.logQualityMetric(transcriptId, "quality_tests_summary", {
    passedCount,
    totalTests,
    allPassed: passedCount === totalTests,
    results: results.map((r) => ({ testName: r.testName, passed: r.passed }))
  });
  return results;
}
var init_qualityTests = __esm({
  "server/qualityTests.ts"() {
    "use strict";
    init_profanityDetector();
    init_languagePolicyDetector();
    init_participationAnalyzer();
    init_qualityLogger();
  }
});

// server/index.ts
import "dotenv/config";
import express2 from "express";
import cors from "cors";

// server/routes.ts
import { createServer } from "http";

// server/storage.ts
init_schema();
init_db();
import { eq, desc, sql as sql2 } from "drizzle-orm";
var DatabaseStorage = class {
  // User operations
  async getUser(id) {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }
  async getUserByEmail(email) {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }
  async upsertUser(userData) {
    const [user] = await db.insert(users).values(userData).onConflictDoUpdate({
      target: users.id,
      set: {
        ...userData,
        updatedAt: /* @__PURE__ */ new Date()
      }
    }).returning();
    return user;
  }
  async ensureAdminUser() {
    return await db.transaction(async (tx) => {
      const [existingAdmin] = await tx.select().from(users).where(eq(users.role, UserRole.ADMIN)).limit(1);
      if (existingAdmin) {
        return existingAdmin;
      }
      const [admin] = await tx.insert(users).values({
        displayName: "Admin",
        email: "admin@local.dev",
        role: UserRole.ADMIN,
        firstName: "Admin",
        lastName: "User"
      }).onConflictDoUpdate({
        target: users.email,
        set: {
          role: UserRole.ADMIN
          // Ensure role is admin even if user exists
        }
      }).returning();
      console.log("[Storage] Created/updated admin user:", admin.id);
      return admin;
    });
  }
  // Device authentication operations (for development)
  async findDeviceByHash(hashedDeviceId) {
    const [deviceRecord] = await db.select().from(deviceIdentifiers).where(eq(deviceIdentifiers.hashedDeviceId, hashedDeviceId)).limit(1);
    if (!deviceRecord) {
      return void 0;
    }
    return await this.getUser(deviceRecord.userId);
  }
  async allocateDevice(hashedDeviceId) {
    return await db.transaction(async (tx) => {
      const result = await tx.execute(sql2`
        SELECT MAX(
          CASE 
            WHEN display_name ~ '^Device_[0-9]+$' 
            THEN CAST(SUBSTRING(display_name FROM 'Device_([0-9]+)') AS INTEGER)
            ELSE 0
          END
        ) as max_num
        FROM ${users}
        WHERE display_name LIKE 'Device_%'
      `);
      const maxNumber = result.rows[0]?.max_num ? parseInt(result.rows[0].max_num.toString(), 10) : 0;
      const nextNumber = maxNumber + 1;
      const displayName = `Device_${nextNumber.toString().padStart(2, "0")}`;
      const [user] = await tx.insert(users).values({
        displayName,
        email: null,
        // Devices don't have emails
        firstName: null,
        lastName: null,
        profileImageUrl: null
      }).returning();
      await tx.insert(deviceIdentifiers).values({
        hashedDeviceId,
        userId: user.id
      });
      return user;
    });
  }
  // Transcript operations
  async createTranscript(transcriptData) {
    const [transcript] = await db.insert(transcripts).values(transcriptData).returning();
    return transcript;
  }
  async getTranscript(id) {
    const [transcript] = await db.select().from(transcripts).where(eq(transcripts.id, id));
    return transcript;
  }
  async getTranscriptBySonioxJobId(sonioxJobId) {
    const [transcript] = await db.select().from(transcripts).where(eq(transcripts.sonioxJobId, sonioxJobId));
    return transcript;
  }
  async getUserTranscripts(userId) {
    return await db.select().from(transcripts).where(eq(transcripts.userId, userId)).orderBy(desc(transcripts.createdAt));
  }
  async appendSegments(transcriptId, newSegments, fromIndex) {
    const newSegmentsJson = JSON.stringify(newSegments);
    const [updated] = await db.update(transcripts).set({
      // Atomically concatenate: COALESCE handles null, ${transcripts.segments} references column
      segments: sql2`COALESCE(${transcripts.segments}, '[]'::jsonb) || ${newSegmentsJson}::jsonb`,
      // Atomically calculate new index from concatenated result
      lastSegmentIdx: sql2`jsonb_array_length(COALESCE(${transcripts.segments}, '[]'::jsonb) || ${newSegmentsJson}::jsonb)`,
      updatedAt: /* @__PURE__ */ new Date()
    }).where(
      sql2`${transcripts.id} = ${transcriptId} AND ${transcripts.lastSegmentIdx} = ${fromIndex}`
    ).returning();
    if (!updated) {
      const freshTranscript = await db.select().from(transcripts).where(eq(transcripts.id, transcriptId)).limit(1);
      const current = freshTranscript[0];
      throw new Error(`Cursor mismatch: expected ${fromIndex}, got ${current?.lastSegmentIdx ?? "unknown"}`);
    }
    return updated;
  }
  async updateProfanityCount(transcriptId, increment) {
    const [updated] = await db.update(transcripts).set({
      profanityCount: sql2`COALESCE(${transcripts.profanityCount}, 0) + ${increment}`,
      updatedAt: /* @__PURE__ */ new Date()
    }).where(eq(transcripts.id, transcriptId)).returning();
    if (!updated) {
      throw new Error("Transcript not found");
    }
    return updated;
  }
  async updateLanguagePolicyViolations(transcriptId, increment) {
    const [updated] = await db.update(transcripts).set({
      languagePolicyViolations: sql2`COALESCE(${transcripts.languagePolicyViolations}, 0) + ${increment}`,
      updatedAt: /* @__PURE__ */ new Date()
    }).where(eq(transcripts.id, transcriptId)).returning();
    if (!updated) {
      throw new Error("Transcript not found");
    }
    return updated;
  }
  async updateParticipationBalance(transcriptId, balance) {
    const [updated] = await db.update(transcripts).set({
      participationBalance: balance,
      updatedAt: /* @__PURE__ */ new Date()
    }).where(eq(transcripts.id, transcriptId)).returning();
    if (!updated) {
      throw new Error("Transcript not found");
    }
    return updated;
  }
  async updateTopicAdherence(transcriptId, score) {
    const [updated] = await db.update(transcripts).set({
      topicAdherenceScore: score,
      updatedAt: /* @__PURE__ */ new Date()
    }).where(eq(transcripts.id, transcriptId)).returning();
    if (!updated) {
      throw new Error("Transcript not found");
    }
    return updated;
  }
  async updateTopicConfig(transcriptId, config) {
    const [updated] = await db.update(transcripts).set({
      topicPrompt: config.topicPrompt,
      topicKeywords: config.topicKeywords,
      updatedAt: /* @__PURE__ */ new Date()
    }).where(eq(transcripts.id, transcriptId)).returning();
    if (!updated) {
      throw new Error("Transcript not found");
    }
    return updated;
  }
  async updateParticipationConfig(transcriptId, config) {
    const [updated] = await db.update(transcripts).set({
      participationConfig: config,
      updatedAt: /* @__PURE__ */ new Date()
    }).where(eq(transcripts.id, transcriptId)).returning();
    if (!updated) {
      throw new Error("Transcript not found");
    }
    return updated;
  }
  async completeTranscript(transcriptId, finalData) {
    const [updated] = await db.update(transcripts).set({
      status: "complete",
      duration: finalData.duration,
      audioFileUrl: finalData.audioFileUrl,
      updatedAt: /* @__PURE__ */ new Date()
    }).where(eq(transcripts.id, transcriptId)).returning();
    if (!updated) {
      throw new Error("Transcript not found");
    }
    return updated;
  }
  // Flagged content operations
  async createFlaggedContent(flaggedData) {
    const [flagged] = await db.insert(flaggedContent).values(flaggedData).returning();
    return flagged;
  }
  async getTranscriptFlaggedContent(transcriptId) {
    return await db.select().from(flaggedContent).where(eq(flaggedContent.transcriptId, transcriptId)).orderBy(flaggedContent.timestampMs);
  }
  async getUserFlaggedContent(userId) {
    const results = await db.select().from(flaggedContent).innerJoin(transcripts, eq(flaggedContent.transcriptId, transcripts.id)).where(eq(transcripts.userId, userId)).orderBy(desc(flaggedContent.createdAt));
    return results.map((row) => ({
      ...row.flagged_content,
      transcript: row.transcripts
    }));
  }
  // Dashboard operations
  async getDashboardOverview() {
    const results = await db.execute(sql2`
      WITH transcript_stats AS (
        SELECT 
          user_id,
          COUNT(*)::int as session_count,
          MAX(created_at) as last_activity
        FROM ${transcripts}
        GROUP BY user_id
      ),
      flag_stats AS (
        SELECT 
          t.user_id,
          COUNT(*)::int as flag_count
        FROM ${flaggedContent} fc
        INNER JOIN ${transcripts} t ON fc.transcript_id = t.id
        GROUP BY t.user_id
      )
      SELECT 
        u.id as user_id,
        u.display_name,
        COALESCE(ts.session_count, 0) as session_count,
        COALESCE(fs.flag_count, 0) as flag_count,
        ts.last_activity
      FROM ${users} u
      LEFT JOIN transcript_stats ts ON u.id = ts.user_id
      LEFT JOIN flag_stats fs ON u.id = fs.user_id
      ORDER BY ts.last_activity DESC NULLS LAST, u.created_at DESC
    `);
    return results.rows.map((row) => ({
      userId: row.user_id,
      displayName: row.display_name,
      sessionCount: parseInt(row.session_count, 10),
      flagCount: parseInt(row.flag_count, 10),
      lastActivity: row.last_activity
    }));
  }
  async getDeviceDashboard(deviceId) {
    const user = await this.getUser(deviceId);
    if (!user) {
      return null;
    }
    const sessions2 = await this.getUserTranscripts(deviceId);
    const flaggedContent2 = await this.getUserFlaggedContent(deviceId);
    return {
      user,
      sessions: sessions2,
      flaggedContent: flaggedContent2
    };
  }
};
var storage = new DatabaseStorage();

// server/auth.ts
import session from "express-session";
import connectPg from "connect-pg-simple";
function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1e3;
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: sessionTtl,
    tableName: "sessions"
  });
  const sessionSecret = process.env.SESSION_SECRET || (process.env.NODE_ENV === "development" ? "dev-session-secret-change-in-production" : void 0);
  if (!sessionSecret) {
    throw new Error("SESSION_SECRET must be set. Generate a random secret for production.");
  }
  const cookieConfig = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    // Only use secure cookies in production
    maxAge: sessionTtl
  };
  if (process.env.ALLOWED_ORIGIN) {
    cookieConfig.sameSite = "none";
  }
  return session({
    secret: sessionSecret,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: cookieConfig
  });
}
async function setupAuth(app2) {
  app2.set("trust proxy", 1);
  app2.use(getSession());
  app2.get("/api/logout", (req, res) => {
    req.session?.destroy(() => {
      res.redirect("/");
    });
  });
}
var isAuthenticated = async (req, res, next) => {
  const session2 = req.session;
  if (session2?.deviceUserId) {
    try {
      const deviceUser = await storage.getUser(session2.deviceUserId);
      if (deviceUser) {
        req.user = {
          claims: {
            sub: deviceUser.id,
            email: deviceUser.email,
            first_name: deviceUser.firstName,
            last_name: deviceUser.lastName
          },
          displayName: deviceUser.displayName
        };
        return next();
      }
    } catch (error) {
      console.error("Error loading device user:", error);
    }
  }
  return res.status(401).json({ message: "Unauthorized" });
};

// server/objectStorage.ts
import { Storage } from "@google-cloud/storage";
import { randomUUID } from "crypto";

// server/objectAcl.ts
var ACL_POLICY_METADATA_KEY = "custom:aclPolicy";
async function setObjectAclPolicy(objectFile, aclPolicy) {
  const [exists] = await objectFile.exists();
  if (!exists) {
    throw new Error(`Object not found: ${objectFile.name}`);
  }
  await objectFile.setMetadata({
    metadata: {
      [ACL_POLICY_METADATA_KEY]: JSON.stringify(aclPolicy)
    }
  });
}
async function getObjectAclPolicy(objectFile) {
  const [metadata] = await objectFile.getMetadata();
  const aclPolicy = metadata?.metadata?.[ACL_POLICY_METADATA_KEY];
  if (!aclPolicy) {
    return null;
  }
  return JSON.parse(aclPolicy);
}
async function canAccessObject({
  userId,
  objectFile,
  requestedPermission
}) {
  const aclPolicy = await getObjectAclPolicy(objectFile);
  if (!aclPolicy) {
    return false;
  }
  if (aclPolicy.visibility === "public" && requestedPermission === "read" /* READ */) {
    return true;
  }
  if (!userId) {
    return false;
  }
  if (aclPolicy.owner === userId) {
    return true;
  }
  return false;
}

// server/objectStorage.ts
var objectStorageClient = (() => {
  try {
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      return new Storage({
        keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS
      });
    }
    if (process.env.GCS_SERVICE_ACCOUNT_KEY) {
      const credentials = JSON.parse(process.env.GCS_SERVICE_ACCOUNT_KEY);
      return new Storage({
        credentials,
        projectId: credentials.project_id
      });
    }
    return new Storage();
  } catch (error) {
    console.error("Error initializing Google Cloud Storage:", error);
    throw new Error(
      "Failed to initialize Google Cloud Storage. Set GOOGLE_APPLICATION_CREDENTIALS or GCS_SERVICE_ACCOUNT_KEY environment variable."
    );
  }
})();
var ObjectNotFoundError = class _ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, _ObjectNotFoundError.prototype);
  }
};
var ObjectStorageService = class {
  constructor() {
  }
  // Gets the private object directory.
  getPrivateObjectDir() {
    const dir = process.env.PRIVATE_OBJECT_DIR || "";
    if (!dir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Set this to your GCS bucket path (e.g., 'my-bucket-name' or 'my-bucket-name/folder')"
      );
    }
    return dir;
  }
  // Downloads an object to the response.
  async downloadObject(file, res, cacheTtlSec = 3600) {
    try {
      const [metadata] = await file.getMetadata();
      const aclPolicy = await getObjectAclPolicy(file);
      const isPublic = aclPolicy?.visibility === "public";
      res.set({
        "Content-Type": metadata.contentType || "application/octet-stream",
        "Content-Length": metadata.size,
        "Cache-Control": `${isPublic ? "public" : "private"}, max-age=${cacheTtlSec}`
      });
      const stream = file.createReadStream();
      stream.on("error", (err) => {
        console.error("Stream error:", err);
        if (!res.headersSent) {
          res.status(500).json({ error: "Error streaming file" });
        }
      });
      stream.pipe(res);
    } catch (error) {
      console.error("Error downloading file:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Error downloading file" });
      }
    }
  }
  // Gets the upload URL for an object entity.
  async getObjectEntityUploadURL() {
    const privateObjectDir = this.getPrivateObjectDir();
    if (!privateObjectDir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Set this to your GCS bucket path."
      );
    }
    const objectId = randomUUID();
    const fullPath = `${privateObjectDir}/uploads/${objectId}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);
    const bucket = objectStorageClient.bucket(bucketName);
    const file = bucket.file(objectName);
    const [uploadURL] = await file.getSignedUrl({
      action: "write",
      expires: Date.now() + 15 * 60 * 1e3,
      // 15 minutes
      contentType: "application/octet-stream"
    });
    const objectPath = `/objects/uploads/${objectId}`;
    return { uploadURL, objectPath };
  }
  // Gets the object entity file from the object path.
  async getObjectEntityFile(objectPath) {
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }
    const parts = objectPath.slice(1).split("/");
    if (parts.length < 2) {
      throw new ObjectNotFoundError();
    }
    const entityId = parts.slice(1).join("/");
    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith("/")) {
      entityDir = `${entityDir}/`;
    }
    const objectEntityPath = `${entityDir}${entityId}`;
    const { bucketName, objectName } = parseObjectPath(objectEntityPath);
    const bucket = objectStorageClient.bucket(bucketName);
    const objectFile = bucket.file(objectName);
    const [exists] = await objectFile.exists();
    if (!exists) {
      throw new ObjectNotFoundError();
    }
    return objectFile;
  }
  normalizeObjectEntityPath(rawPath) {
    if (!rawPath.startsWith("https://storage.googleapis.com/")) {
      return rawPath;
    }
    const url = new URL(rawPath);
    const rawObjectPath = url.pathname;
    let objectEntityDir = this.getPrivateObjectDir();
    if (!objectEntityDir.endsWith("/")) {
      objectEntityDir = `${objectEntityDir}/`;
    }
    if (!rawObjectPath.startsWith(objectEntityDir)) {
      return rawObjectPath;
    }
    const entityId = rawObjectPath.slice(objectEntityDir.length);
    return `/objects/${entityId}`;
  }
  // Tries to set the ACL policy for the object entity and return the normalized path.
  async trySetObjectEntityAclPolicy(rawPath, aclPolicy) {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith("/")) {
      return normalizedPath;
    }
    const objectFile = await this.getObjectEntityFile(normalizedPath);
    await setObjectAclPolicy(objectFile, aclPolicy);
    return normalizedPath;
  }
  // Checks if the user can access the object entity.
  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission
  }) {
    return canAccessObject({
      userId,
      objectFile,
      requestedPermission: requestedPermission ?? "read" /* READ */
    });
  }
};
function parseObjectPath(path3) {
  if (!path3.startsWith("/")) {
    path3 = `/${path3}`;
  }
  const pathParts = path3.split("/");
  if (pathParts.length < 3) {
    throw new Error("Invalid path: must contain at least a bucket name");
  }
  const bucketName = pathParts[1];
  const objectName = pathParts.slice(2).join("/");
  return {
    bucketName,
    objectName
  };
}

// server/routes.ts
init_profanityDetector();

// server/contentAnalyzer.ts
init_profanityDetector();
init_languagePolicyDetector();
init_participationAnalyzer();

// server/topicAdherenceDetector.ts
var DEFAULT_TOPIC_KEYWORDS = [
  "discuss",
  "discussion",
  "topic",
  "question",
  "answer",
  "think",
  "opinion",
  "agree",
  "disagree",
  "why",
  "how",
  "what",
  "explain",
  "understand",
  "learn",
  "study",
  "class",
  "lesson",
  "subject",
  "idea",
  "point"
];
var OFF_TOPIC_INDICATORS = [
  "game",
  "play",
  "fun",
  "bored",
  "tired",
  "hungry",
  "lunch",
  "break",
  "homework",
  "test",
  "exam",
  "grade",
  "teacher",
  "school",
  "friend",
  "phone",
  "video",
  "movie",
  "music",
  "song",
  "dance"
];
function analyzeTopicAdherence(segments, transcriptId, config) {
  const topicKeywords = config?.topicKeywords || DEFAULT_TOPIC_KEYWORDS;
  const offTopicIndicators = config?.offTopicIndicators || OFF_TOPIC_INDICATORS;
  const topicPrompt = config?.topicPrompt;
  if (segments.length === 0) {
    return {
      score: 1,
      offTopicSegments: [],
      detectedKeywords: [],
      offTopicIndicators: []
    };
  }
  const detectedKeywords = /* @__PURE__ */ new Set();
  const offTopicIndicatorsFound = /* @__PURE__ */ new Set();
  const offTopicSegments = [];
  let onTopicCount = 0;
  let offTopicCount = 0;
  const normalizedTopicKeywords = topicKeywords.map((k) => k.toLowerCase());
  const normalizedOffTopicIndicators = offTopicIndicators.map((k) => k.toLowerCase());
  for (const segment of segments) {
    const text2 = segment.text.toLowerCase();
    const words = text2.split(/\s+/);
    let hasTopicKeyword = false;
    for (const word of words) {
      const cleanWord = word.replace(/[^\w]/g, "");
      if (normalizedTopicKeywords.includes(cleanWord)) {
        detectedKeywords.add(cleanWord);
        hasTopicKeyword = true;
      }
      if (normalizedOffTopicIndicators.includes(cleanWord)) {
        offTopicIndicatorsFound.add(cleanWord);
      }
    }
    const hasOffTopicIndicators = Array.from(offTopicIndicatorsFound).some(
      (indicator) => text2.includes(indicator)
    );
    if (!hasTopicKeyword && hasOffTopicIndicators) {
      offTopicCount++;
      const startTimeMs = segment.startTime * 1e3;
      offTopicSegments.push({
        transcriptId,
        flaggedWord: "off_topic",
        context: segment.text.substring(0, 150),
        timestampMs: Math.floor(startTimeMs),
        speaker: segment.speaker,
        flagType: "off_topic"
      });
    } else {
      onTopicCount++;
    }
  }
  const totalSegments = segments.length;
  const score = totalSegments > 0 ? onTopicCount / totalSegments : 1;
  return {
    score,
    offTopicSegments,
    detectedKeywords: Array.from(detectedKeywords),
    offTopicIndicators: Array.from(offTopicIndicatorsFound)
  };
}

// server/contentAnalyzer.ts
init_qualityLogger();
function analyzeSegmentParticipation(segment, allSegments, transcriptId, config) {
  const participationFlags = [];
  if (allSegments.length === 0) {
    return participationFlags;
  }
  const speakerStats = /* @__PURE__ */ new Map();
  for (const seg of allSegments) {
    const speakerId = seg.speaker;
    const duration = seg.endTime - seg.startTime;
    const existing = speakerStats.get(speakerId) || { talkTime: 0, segmentCount: 0 };
    speakerStats.set(speakerId, {
      talkTime: existing.talkTime + duration,
      segmentCount: existing.segmentCount + 1
    });
  }
  const totalTalkTime = Array.from(speakerStats.values()).reduce(
    (sum, stat) => sum + stat.talkTime,
    0
  );
  if (totalTalkTime === 0) {
    return participationFlags;
  }
  const segmentSpeakerStats = speakerStats.get(segment.speaker);
  if (!segmentSpeakerStats) {
    return participationFlags;
  }
  const speakerPercentage = segmentSpeakerStats.talkTime / totalTalkTime;
  const startTimeMs = segment.startTime * 1e3;
  const DOMINANCE_THRESHOLD = config?.dominanceThreshold ?? 0.5;
  const SILENCE_THRESHOLD = config?.silenceThreshold ?? 0.05;
  if (speakerPercentage > DOMINANCE_THRESHOLD) {
    participationFlags.push({
      transcriptId,
      flaggedWord: "participation_dominance",
      context: segment.text.substring(0, 150),
      timestampMs: Math.floor(startTimeMs),
      speaker: segment.speaker,
      flagType: "participation"
    });
  }
  if (speakerStats.size >= 3 && speakerPercentage < SILENCE_THRESHOLD && segmentSpeakerStats.segmentCount > 0) {
    participationFlags.push({
      transcriptId,
      flaggedWord: "participation_silence",
      context: segment.text.substring(0, 150),
      timestampMs: Math.floor(startTimeMs),
      speaker: segment.speaker,
      flagType: "participation"
    });
  }
  return participationFlags;
}
function analyzeSegment(segment, transcriptId, allowedLanguage = "en", allSegments, topicConfig, participationConfig) {
  const profanityItems = [];
  const languageItems = [];
  const offTopicItems = [];
  const profanityResult = detectProfanity([segment], transcriptId);
  profanityItems.push(...profanityResult.flaggedItems);
  const startTimeMs = segment.startTime * 1e3;
  if (segment.language && segment.language.toLowerCase() !== allowedLanguage.toLowerCase()) {
    languageItems.push({
      transcriptId,
      flaggedWord: segment.language,
      context: segment.text.substring(0, 100),
      timestampMs: Math.floor(startTimeMs),
      speaker: segment.speaker,
      flagType: "language_policy"
    });
  }
  const topicKeywords = topicConfig?.topicKeywords || [
    "discuss",
    "discussion",
    "topic",
    "question",
    "answer",
    "think",
    "opinion",
    "agree",
    "disagree",
    "why",
    "how",
    "what",
    "explain",
    "understand",
    "learn",
    "study",
    "class",
    "lesson",
    "subject",
    "idea",
    "point"
  ];
  const OFF_TOPIC_INDICATORS2 = [
    "game",
    "play",
    "fun",
    "bored",
    "tired",
    "hungry",
    "lunch",
    "break",
    "homework",
    "test",
    "exam",
    "grade",
    "teacher",
    "school",
    "friend",
    "phone",
    "video",
    "movie",
    "music",
    "song",
    "dance"
  ];
  const text2 = segment.text.toLowerCase();
  const segmentWords = text2.split(/\s+/);
  let hasTopicKeyword = false;
  let hasOffTopicIndicators = false;
  const normalizedTopicKeywords = topicKeywords.map((k) => k.toLowerCase());
  for (const word of segmentWords) {
    const cleanWord = word.replace(/[^\w]/g, "");
    if (normalizedTopicKeywords.includes(cleanWord)) {
      hasTopicKeyword = true;
    }
    if (OFF_TOPIC_INDICATORS2.map((k) => k.toLowerCase()).includes(cleanWord)) {
      hasOffTopicIndicators = true;
    }
  }
  if (!hasTopicKeyword && hasOffTopicIndicators) {
    offTopicItems.push({
      transcriptId,
      flaggedWord: "off_topic",
      context: segment.text.substring(0, 150),
      timestampMs: Math.floor(startTimeMs),
      speaker: segment.speaker,
      flagType: "off_topic"
    });
  }
  let participationItems = [];
  if (allSegments && allSegments.length > 0) {
    participationItems = analyzeSegmentParticipation(segment, allSegments, transcriptId, participationConfig);
  }
  return {
    profanity: profanityItems,
    languagePolicy: languageItems,
    offTopic: offTopicItems,
    participation: participationItems
  };
}
async function analyzeContent(segments, transcriptId, allowedLanguage = "en", topicConfig, participationConfig) {
  const [profanity, languagePolicy, participation, topicAdherence] = await Promise.all([
    Promise.resolve(detectProfanity(segments, transcriptId)),
    Promise.resolve(detectLanguagePolicyViolations(segments, transcriptId, allowedLanguage)),
    Promise.resolve(analyzeParticipationBalance(segments, participationConfig)),
    Promise.resolve(analyzeTopicAdherence(segments, transcriptId, topicConfig))
  ]);
  const allFlaggedItems = [
    ...profanity.flaggedItems,
    ...languagePolicy.violations,
    ...topicAdherence.offTopicSegments
  ];
  if (profanity.hasProfanity) {
    await qualityLogger.logDetectionDecision(transcriptId, "profanity_detected", {
      count: profanity.flaggedItems.length,
      words: profanity.flaggedItems.map((f) => f.flaggedWord)
    });
  }
  if (languagePolicy.hasViolations) {
    await qualityLogger.logDetectionDecision(transcriptId, "language_policy_violation", {
      count: languagePolicy.violations.length,
      detectedLanguages: Array.from(new Set(languagePolicy.violations.map((v) => v.flaggedWord))).sort(),
      allowedLanguage
    });
  }
  if (!participation.isBalanced) {
    await qualityLogger.logDetectionDecision(transcriptId, "participation_imbalance", {
      dominantSpeaker: participation.dominantSpeaker,
      silentSpeakers: participation.silentSpeakers,
      reason: participation.imbalanceReason
    });
  }
  if (topicAdherence.score < 0.7) {
    await qualityLogger.logDetectionDecision(transcriptId, "low_topic_adherence", {
      score: topicAdherence.score,
      offTopicCount: topicAdherence.offTopicSegments.length
    });
  }
  await qualityLogger.logQualityMetric(transcriptId, "participation_balance", {
    speakers: participation.speakers,
    isBalanced: participation.isBalanced
  });
  await qualityLogger.logQualityMetric(transcriptId, "topic_adherence_score", topicAdherence.score, {
    detectedKeywords: topicAdherence.detectedKeywords,
    offTopicIndicators: topicAdherence.offTopicIndicators
  });
  return {
    profanity,
    languagePolicy,
    participation,
    topicAdherence,
    allFlaggedItems
  };
}

// server/routes.ts
init_qualityLogger();

// server/websocketService.ts
import { WebSocketServer, WebSocket } from "ws";
import { parse as parseUrl } from "url";
import { parse as parseCookie } from "cookie";
init_schema();
init_db();
var WebSocketService = class {
  wss = null;
  adminClients = /* @__PURE__ */ new Set();
  async getUserIdFromSession(request) {
    try {
      const cookies = request.headers.cookie;
      if (!cookies) return null;
      const parsedCookies = parseCookie(cookies);
      let sessionId = parsedCookies["connect.sid"];
      if (!sessionId) return null;
      if (sessionId.startsWith("s:")) {
        sessionId = sessionId.substring(2).split(".")[0];
      }
      const result = await pool.query(
        "SELECT sess FROM sessions WHERE sid = $1 AND expire > NOW()",
        [sessionId]
      );
      if (result.rows.length === 0) {
        return null;
      }
      const session2 = result.rows[0].sess;
      if (session2.deviceUserId) {
        return session2.deviceUserId;
      }
      if (session2.passport?.user?.claims?.sub) {
        return session2.passport.user.claims.sub;
      }
      return null;
    } catch (error) {
      console.error("[WebSocket] Session parsing error:", error);
      return null;
    }
  }
  initialize(httpServer) {
    this.wss = new WebSocketServer({ noServer: true });
    httpServer.on("upgrade", async (request, socket, head) => {
      const { pathname } = parseUrl(request.url || "");
      if (pathname === "/ws/monitor") {
        try {
          const userId = await this.getUserIdFromSession(request);
          if (!userId) {
            console.log("[WebSocket] No valid session found");
            socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
            socket.destroy();
            return;
          }
          const user = await storage.getUser(userId);
          if (!user || user.role !== UserRole.ADMIN) {
            console.log(`[WebSocket] Non-admin user ${userId} rejected`);
            socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
            socket.destroy();
            return;
          }
          request.userId = userId;
          this.wss.handleUpgrade(request, socket, head, (ws2) => {
            this.wss.emit("connection", ws2, request);
          });
        } catch (error) {
          console.error("[WebSocket] Upgrade error:", error);
          socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
          socket.destroy();
        }
      }
    });
    this.wss.on("connection", (ws2, request) => {
      const userId = request.userId;
      if (!userId) {
        console.error("[WebSocket] Connection without userId, this should not happen");
        ws2.close(1011, "Internal server error");
        return;
      }
      const client = { ws: ws2, userId };
      this.adminClients.add(client);
      console.log(`[WebSocket] Admin client connected: ${userId}`);
      ws2.send(JSON.stringify({
        type: "CONNECTED",
        message: "Admin monitoring connected",
        userId
      }));
      ws2.on("close", () => {
        this.adminClients.delete(client);
        console.log(`[WebSocket] Admin client disconnected: ${userId}`);
      });
      ws2.on("error", (error) => {
        console.error(`[WebSocket] Client error for ${userId}:`, error);
        this.adminClients.delete(client);
      });
    });
    console.log("[WebSocket] Service initialized for admin monitoring");
  }
  /**
   * Broadcast any type of alert to all connected admin clients
   */
  broadcastAlert(payload) {
    if (!this.wss) {
      console.warn("[WebSocket] Cannot broadcast: service not initialized");
      return;
    }
    const message = JSON.stringify(payload);
    let sentCount = 0;
    const clients = Array.from(this.adminClients);
    for (const client of clients) {
      if (client.ws.readyState === WebSocket.OPEN) {
        try {
          client.ws.send(message);
          sentCount++;
        } catch (error) {
          console.error(`[WebSocket] Error sending to client ${client.userId}:`, error);
        }
      }
    }
    console.log(`[WebSocket] ${payload.type} broadcasted to ${sentCount} admin clients`);
  }
  /**
   * Legacy method for backward compatibility
   */
  broadcastProfanityAlert(payload) {
    this.broadcastAlert(payload);
  }
  getConnectedAdminCount() {
    return this.adminClients.size;
  }
};
var websocketService = new WebSocketService();

// server/middleware/requireAdmin.ts
init_schema();
async function requireAdmin(req, res, next) {
  try {
    let userId;
    if (req.session && req.session.deviceUserId) {
      userId = req.session.deviceUserId;
    } else if (req.user?.claims?.sub) {
      userId = req.user.claims.sub;
    }
    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }
    const dbUser = await storage.getUser(userId);
    if (!dbUser) {
      return res.status(401).json({ message: "User not found" });
    }
    if (dbUser.role !== UserRole.ADMIN) {
      return res.status(403).json({ message: "Admin access required" });
    }
    req.authUser = dbUser;
    next();
  } catch (error) {
    console.error("[requireAdmin] Error fetching user:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

// server/routes.ts
import multer from "multer";
import fs from "fs";
import crypto from "crypto";
var upload = multer({ dest: "uploads/" });
async function registerRoutes(app2) {
  const SONIOX_API_KEY = process.env.SONIOX_API_KEY;
  if (!SONIOX_API_KEY) {
    console.warn("Warning: SONIOX_API_KEY not found in environment variables");
  }
  await setupAuth(app2);
  app2.post("/api/auth/device", async (req, res) => {
    try {
      if (process.env.NODE_ENV !== "development") {
        return res.status(403).json({ error: "Device auth only available in development" });
      }
      const { deviceId } = req.body;
      if (!deviceId) {
        return res.status(400).json({ error: "deviceId is required" });
      }
      const hashedDeviceId = crypto.createHash("sha256").update(deviceId).digest("hex");
      let user = await storage.findDeviceByHash(hashedDeviceId);
      if (!user) {
        user = await storage.allocateDevice(hashedDeviceId);
        console.log(`[DeviceAuth] Created new device: ${user.displayName}`);
      } else {
        console.log(`[DeviceAuth] Existing device: ${user.displayName}`);
      }
      req.session.deviceUserId = user.id;
      req.session.save((err) => {
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
  app2.post("/api/auth/admin", async (req, res) => {
    try {
      if (process.env.NODE_ENV !== "development") {
        return res.status(403).json({ error: "Admin login only available in development" });
      }
      const adminUser = await storage.getUserByEmail("admin@local.dev");
      if (!adminUser) {
        return res.status(404).json({ error: "Admin user not found" });
      }
      req.session.deviceUserId = adminUser.id;
      req.session.save((err) => {
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
  app2.get("/api/auth/user", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      res.json(user);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });
  app2.post("/api/get-temp-api-key", async (req, res) => {
    try {
      if (!SONIOX_API_KEY) {
        return res.status(500).json({ error: "Soniox API key not configured" });
      }
      const response = await fetch(
        "https://api.soniox.com/v1/auth/temporary-api-key",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${SONIOX_API_KEY}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            usage_type: "transcribe_websocket",
            expires_in_seconds: 3600
            // 1 hour
          })
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
  app2.post("/api/objects/upload", isAuthenticated, async (req, res) => {
    const objectStorageService = new ObjectStorageService();
    const { uploadURL, objectPath } = await objectStorageService.getObjectEntityUploadURL();
    res.json({ uploadURL, objectPath });
  });
  app2.post("/api/save-audio", isAuthenticated, async (req, res) => {
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
          visibility: "private"
        }
      );
      res.json({ objectPath });
    } catch (error) {
      console.error("Error saving audio file:", error);
      res.status(500).json({ error: "Failed to save audio file" });
    }
  });
  app2.get("/objects/:objectPath(*)", isAuthenticated, async (req, res) => {
    const userId = req.user?.claims?.sub;
    const objectStorageService = new ObjectStorageService();
    try {
      const objectFile = await objectStorageService.getObjectEntityFile(
        req.path
      );
      const canAccess = await objectStorageService.canAccessObjectEntity({
        objectFile,
        userId
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
  app2.post("/api/save-live-transcript", isAuthenticated, async (req, res) => {
    try {
      const { title, audioFileUrl, duration, language, segments } = req.body;
      const userId = req.user.claims.sub;
      if (!segments || segments.length === 0) {
        return res.status(400).json({ error: "segments are required" });
      }
      const savedTranscript = await storage.createTranscript({
        userId,
        title: title || `Live Recording ${(/* @__PURE__ */ new Date()).toLocaleString()}`,
        audioFileUrl: audioFileUrl || null,
        duration: duration || 0,
        source: "live",
        language: language || "en",
        segments,
        status: "complete"
        // Mark as complete for legacy endpoint
      });
      const profanityDetection = detectProfanity(segments, savedTranscript.id);
      if (profanityDetection.hasProfanity) {
        for (const flagged of profanityDetection.flaggedItems) {
          await storage.createFlaggedContent(flagged);
        }
      }
      console.log(`[Live Recording] Saved with ID: ${savedTranscript.id}, ${profanityDetection.flaggedItems.length} flagged items`);
      res.json({
        ...savedTranscript,
        flaggedContent: profanityDetection.flaggedItems
      });
    } catch (error) {
      console.error("Error saving live transcript:", error);
      res.status(500).json({ error: "Failed to save live transcript" });
    }
  });
  app2.post("/api/transcripts", isAuthenticated, async (req, res) => {
    try {
      const { title, language, topicPrompt, topicKeywords, participationConfig } = req.body;
      const userId = req.user.claims.sub;
      const transcript = await storage.createTranscript({
        userId,
        title: title || `Live Recording ${(/* @__PURE__ */ new Date()).toLocaleString()}`,
        source: "live",
        language: language || "en",
        segments: [],
        // Start with empty segments
        status: "draft",
        topicPrompt: topicPrompt || null,
        topicKeywords: topicKeywords || null,
        participationConfig: participationConfig || null
      });
      console.log(`[Draft Transcript] Created ID: ${transcript.id}`);
      res.json(transcript);
    } catch (error) {
      console.error("Error creating draft transcript:", error);
      res.status(500).json({ error: "Failed to create transcript" });
    }
  });
  app2.patch("/api/transcripts/:id/segments", isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      const { segments: newSegments, fromIndex } = req.body;
      const userId = req.user.claims.sub;
      if (!newSegments || !Array.isArray(newSegments) || newSegments.length === 0) {
        return res.status(400).json({ error: "segments array is required" });
      }
      if (typeof fromIndex !== "number") {
        return res.status(400).json({ error: "fromIndex is required" });
      }
      const existing = await storage.getTranscript(id);
      if (!existing) {
        return res.status(404).json({ error: "Transcript not found" });
      }
      if (existing.userId !== userId) {
        return res.status(403).json({ error: "Access denied" });
      }
      const updated = await storage.appendSegments(id, newSegments, fromIndex);
      const allSegments = updated.segments;
      const recentSegments = allSegments.slice(fromIndex);
      const allowedLanguage = process.env.ALLOWED_LANGUAGE || "en";
      const topicConfig = existing.topicKeywords || existing.topicPrompt ? {
        topicKeywords: existing.topicKeywords,
        topicPrompt: existing.topicPrompt
      } : void 0;
      const participationConfig = existing.participationConfig;
      let totalNewFlags = 0;
      let profanityCount = 0;
      let languagePolicyCount = 0;
      let offTopicCount = 0;
      const deviceUser = await storage.getUser(userId);
      for (const segment of recentSegments) {
        const analysis = analyzeSegment(segment, id, allowedLanguage, allSegments, topicConfig, participationConfig);
        for (const flagged of analysis.profanity) {
          await storage.createFlaggedContent(flagged);
          totalNewFlags++;
          profanityCount++;
          websocketService.broadcastAlert({
            type: "PROFANITY_ALERT",
            deviceId: userId,
            deviceName: deviceUser?.displayName || "Unknown Group",
            transcriptId: id,
            flaggedWord: flagged.flaggedWord,
            timestampMs: flagged.timestampMs,
            speaker: flagged.speaker || "Unknown",
            context: flagged.context || "",
            flagType: "profanity"
          });
        }
        for (const violation of analysis.languagePolicy) {
          await storage.createFlaggedContent(violation);
          totalNewFlags++;
          languagePolicyCount++;
          websocketService.broadcastAlert({
            type: "LANGUAGE_POLICY_ALERT",
            deviceId: userId,
            deviceName: deviceUser?.displayName || "Unknown Group",
            transcriptId: id,
            flaggedWord: violation.flaggedWord,
            // Detected language
            timestampMs: violation.timestampMs,
            speaker: violation.speaker || "Unknown",
            context: violation.context || "",
            flagType: "language_policy"
          });
        }
        for (const offTopic of analysis.offTopic) {
          await storage.createFlaggedContent(offTopic);
          totalNewFlags++;
          offTopicCount++;
          websocketService.broadcastAlert({
            type: "TOPIC_ADHERENCE_ALERT",
            deviceId: userId,
            deviceName: deviceUser?.displayName || "Unknown Group",
            transcriptId: id,
            flaggedWord: offTopic.flaggedWord,
            timestampMs: offTopic.timestampMs,
            speaker: offTopic.speaker || "Unknown",
            context: offTopic.context || "",
            flagType: "off_topic"
          });
        }
        for (const participation of analysis.participation) {
          await storage.createFlaggedContent(participation);
          totalNewFlags++;
          websocketService.broadcastAlert({
            type: "PARTICIPATION_ALERT",
            deviceId: userId,
            deviceName: deviceUser?.displayName || "Unknown Group",
            transcriptId: id,
            flaggedWord: participation.flaggedWord,
            timestampMs: participation.timestampMs,
            speaker: participation.speaker || "Unknown",
            context: participation.context || "",
            flagType: "participation"
          });
        }
      }
      if (profanityCount > 0) {
        await storage.updateProfanityCount(id, profanityCount);
      }
      if (languagePolicyCount > 0) {
        await storage.updateLanguagePolicyViolations(id, languagePolicyCount);
      }
      console.log(`[Append Segments] Transcript ${id}: appended ${newSegments.length} segments, ${totalNewFlags} new flags (${profanityCount} profanity, ${languagePolicyCount} language, ${offTopicCount} off-topic)`);
      const final = await storage.getTranscript(id);
      res.json({
        ...final,
        newFlaggedItems: recentSegments.flatMap((segment) => {
          const analysis = analyzeSegment(segment, id, allowedLanguage, allSegments, topicConfig, participationConfig);
          return [...analysis.profanity, ...analysis.languagePolicy, ...analysis.offTopic, ...analysis.participation];
        })
      });
    } catch (error) {
      console.error("Error appending segments:", error);
      if (error instanceof Error && error.message.includes("Cursor mismatch")) {
        return res.status(409).json({ error: error.message });
      }
      res.status(500).json({ error: "Failed to append segments" });
    }
  });
  app2.post("/api/transcripts/:id/topic-config", isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      const { topicPrompt, topicKeywords } = req.body;
      const userId = req.user.claims.sub;
      const existing = await storage.getTranscript(id);
      if (!existing) {
        return res.status(404).json({ error: "Transcript not found" });
      }
      if (existing.userId !== userId) {
        return res.status(403).json({ error: "Access denied" });
      }
      const updated = await storage.updateTopicConfig(id, {
        topicPrompt: topicPrompt || void 0,
        topicKeywords: topicKeywords || void 0
      });
      res.json(updated);
    } catch (error) {
      console.error("Error updating topic config:", error);
      res.status(500).json({ error: "Failed to update topic config" });
    }
  });
  app2.post("/api/transcripts/:id/participation-config", isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      const { dominanceThreshold, silenceThreshold } = req.body;
      const userId = req.user.claims.sub;
      const existing = await storage.getTranscript(id);
      if (!existing) {
        return res.status(404).json({ error: "Transcript not found" });
      }
      if (existing.userId !== userId) {
        return res.status(403).json({ error: "Access denied" });
      }
      const updated = await storage.updateParticipationConfig(id, {
        dominanceThreshold: dominanceThreshold !== void 0 ? dominanceThreshold : void 0,
        silenceThreshold: silenceThreshold !== void 0 ? silenceThreshold : void 0
      });
      res.json(updated);
    } catch (error) {
      console.error("Error updating participation config:", error);
      res.status(500).json({ error: "Failed to update participation config" });
    }
  });
  app2.patch("/api/transcripts/:id/complete", isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      const { duration, audioFileUrl } = req.body;
      const userId = req.user.claims.sub;
      const existing = await storage.getTranscript(id);
      if (!existing) {
        return res.status(404).json({ error: "Transcript not found" });
      }
      if (existing.userId !== userId) {
        return res.status(403).json({ error: "Access denied" });
      }
      const segments = existing.segments;
      if (segments.length > 0) {
        const topicConfig = existing.topicKeywords || existing.topicPrompt ? {
          topicKeywords: existing.topicKeywords,
          topicPrompt: existing.topicPrompt
        } : void 0;
        const participationConfig = existing.participationConfig;
        const analysis = await analyzeContent(
          segments,
          id,
          process.env.ALLOWED_LANGUAGE || "en",
          topicConfig,
          participationConfig
        );
        for (const flagged of analysis.allFlaggedItems) {
          await storage.createFlaggedContent(flagged);
        }
        await storage.updateParticipationBalance(id, analysis.participation);
        await storage.updateTopicAdherence(id, analysis.topicAdherence.score);
        const deviceUser = await storage.getUser(userId);
        if (!analysis.participation.isBalanced) {
          websocketService.broadcastAlert({
            type: "PARTICIPATION_ALERT",
            deviceId: userId,
            deviceName: deviceUser?.displayName || "Unknown Group",
            transcriptId: id,
            flaggedWord: "participation_imbalance",
            timestampMs: Math.floor(duration * 1e3) || 0,
            speaker: analysis.participation.dominantSpeaker || "Multiple",
            context: analysis.participation.imbalanceReason || "",
            flagType: "participation"
          });
        }
        if (analysis.topicAdherence.score < 0.7) {
          websocketService.broadcastAlert({
            type: "TOPIC_ADHERENCE_ALERT",
            deviceId: userId,
            deviceName: deviceUser?.displayName || "Unknown Group",
            transcriptId: id,
            flaggedWord: "low_topic_adherence",
            timestampMs: Math.floor(duration * 1e3) || 0,
            speaker: "Group",
            context: `Topic adherence score: ${(analysis.topicAdherence.score * 100).toFixed(0)}%`,
            flagType: "off_topic"
          });
        }
        await qualityLogger.logQualityMetric(id, "final_analysis", {
          profanityCount: analysis.profanity.flaggedItems.length,
          languageViolations: analysis.languagePolicy.violations.length,
          participationBalance: analysis.participation.isBalanced,
          topicAdherenceScore: analysis.topicAdherence.score
        });
        const { runAllQualityTests: runAllQualityTests2 } = await Promise.resolve().then(() => (init_qualityTests(), qualityTests_exports));
        await runAllQualityTests2(
          segments,
          id,
          analysis.allFlaggedItems,
          duration || 0,
          process.env.ALLOWED_LANGUAGE || "en"
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
  app2.get("/api/transcripts", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user.claims.sub;
      const transcripts2 = await storage.getUserTranscripts(userId);
      res.json(transcripts2);
    } catch (error) {
      console.error("Error fetching transcripts:", error);
      res.status(500).json({ error: "Failed to fetch transcripts" });
    }
  });
  app2.get("/api/flagged-content", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user.claims.sub;
      const flaggedContent2 = await storage.getUserFlaggedContent(userId);
      res.json(flaggedContent2);
    } catch (error) {
      console.error("Error fetching flagged content:", error);
      res.status(500).json({ error: "Failed to fetch flagged content" });
    }
  });
  app2.get("/api/dashboard/overview", isAuthenticated, async (req, res) => {
    try {
      const currentUserId = req.user.claims.sub;
      const overview = await storage.getDashboardOverview();
      res.json({ devices: overview, currentUserId });
    } catch (error) {
      console.error("Error fetching dashboard overview:", error);
      res.status(500).json({ error: "Failed to fetch dashboard overview" });
    }
  });
  app2.get("/api/dashboard/device/:deviceId", isAuthenticated, async (req, res) => {
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
  app2.get("/api/dashboard/stats", requireAdmin, async (req, res) => {
    try {
      const overview = await storage.getDashboardOverview();
      const totalDevices = overview.length;
      const totalSessions = overview.reduce((sum, device) => sum + device.sessionCount, 0);
      const totalProfanity = overview.reduce((sum, device) => sum + device.flagCount, 0);
      const devices = overview.map((device) => ({
        id: device.userId,
        name: device.displayName || "Unknown Device",
        totalSessions: device.sessionCount,
        totalProfanity: device.flagCount
      }));
      res.json({
        devices,
        totalDevices,
        totalSessions,
        totalProfanity
      });
    } catch (error) {
      console.error("Error fetching dashboard stats:", error);
      res.status(500).json({ error: "Failed to fetch dashboard stats" });
    }
  });
  app2.get("/api/transcripts/:id", isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.claims.sub;
      const transcript = await storage.getTranscript(id);
      if (!transcript) {
        return res.status(404).json({ error: "Transcript not found" });
      }
      if (transcript.userId !== userId) {
        return res.status(403).json({ error: "Access denied" });
      }
      const flaggedContent2 = await storage.getTranscriptFlaggedContent(id);
      res.json({
        ...transcript,
        flaggedContent: flaggedContent2
      });
    } catch (error) {
      console.error("Error fetching transcript:", error);
      res.status(500).json({ error: "Failed to fetch transcript" });
    }
  });
  app2.post("/api/upload-audio", isAuthenticated, upload.single("audio"), async (req, res) => {
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
      const fileBuffer = fs.readFileSync(filePath);
      const blob = new Blob([fileBuffer], { type: req.file.mimetype || "audio/mpeg" });
      const formData = new FormData();
      formData.append("file", blob, filename);
      const uploadResponse = await fetch("https://api.soniox.com/v1/files", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SONIOX_API_KEY}`
        },
        body: formData
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
      const transcriptionResponse = await fetch(
        "https://api.soniox.com/v1/transcriptions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${SONIOX_API_KEY}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            file_id: fileId,
            model: "stt-async-preview",
            enable_speaker_diarization: true,
            enable_language_identification: selectedLanguage === "auto",
            enable_endpoint_detection: true,
            language_hints: selectedLanguage === "auto" ? ["en", "es", "fr", "de", "pt", "hi", "zh", "ja", "ko"] : [selectedLanguage]
          })
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
      fs.unlinkSync(filePath);
      res.json({
        id: transcriptionId,
        filename,
        status: "processing"
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
  app2.get("/api/transcription/:id", isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.claims.sub;
      console.log(`[Transcription] Polling status for ID: ${id}`);
      if (!SONIOX_API_KEY) {
        return res.status(500).json({ error: "Soniox API key not configured" });
      }
      const existingTranscript = await storage.getTranscriptBySonioxJobId(id);
      if (existingTranscript) {
        if (existingTranscript.userId !== userId) {
          return res.status(403).json({ error: "Access denied" });
        }
        const flaggedContent2 = await storage.getTranscriptFlaggedContent(existingTranscript.id);
        return res.json({
          id,
          status: "completed",
          segments: existingTranscript.segments,
          languages: [existingTranscript.language],
          duration: existingTranscript.duration,
          flaggedContent: flaggedContent2
        });
      }
      const statusResponse = await fetch(
        `https://api.soniox.com/v1/transcriptions/${id}`,
        {
          headers: {
            Authorization: `Bearer ${SONIOX_API_KEY}`
          }
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
        const transcriptResponse = await fetch(
          `https://api.soniox.com/v1/transcriptions/${id}/transcript`,
          {
            headers: {
              Authorization: `Bearer ${SONIOX_API_KEY}`
            }
          }
        );
        if (!transcriptResponse.ok) {
          return res.status(500).json({ error: "Failed to fetch transcript" });
        }
        const transcriptData = await transcriptResponse.json();
        const segments = parseTranscript(transcriptData);
        const languages = extractLanguages(transcriptData);
        const duration = calculateDuration(transcriptData);
        const savedTranscript = await storage.createTranscript({
          userId,
          sonioxJobId: id,
          title: `Transcript ${(/* @__PURE__ */ new Date()).toLocaleDateString()}`,
          audioFileUrl: null,
          duration,
          source: "upload",
          language: languages[0] || "en",
          segments
        });
        const profanityDetection = detectProfanity(segments, savedTranscript.id);
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
          flaggedContent: profanityDetection.flaggedItems
        });
      } else {
        res.json({
          id,
          status,
          segments: [],
          languages: [],
          duration: 0
        });
      }
    } catch (error) {
      console.error("Transcription fetch error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });
  const httpServer = createServer(app2);
  websocketService.initialize(httpServer);
  return httpServer;
}
function parseTranscript(transcriptData) {
  const segments = [];
  if (!transcriptData.tokens || transcriptData.tokens.length === 0) {
    return segments;
  }
  let currentSegment = null;
  let currentSpeaker = "";
  let currentText = "";
  let currentStartTime = 0;
  let currentLanguage = "";
  for (const token of transcriptData.tokens) {
    const speaker = token.speaker || "SPEAKER 1";
    const text2 = token.text || "";
    const startMs = token.start_ms || 0;
    const endMs = token.end_ms || 0;
    const language = token.language || "en";
    const speakerLabel = speaker.startsWith("SPEAKER") ? speaker : `SPEAKER ${speaker}`;
    if (currentSpeaker !== speakerLabel) {
      if (currentSegment) {
        segments.push(currentSegment);
      }
      currentSpeaker = speakerLabel;
      currentText = text2;
      currentStartTime = startMs / 1e3;
      currentLanguage = language;
      currentSegment = {
        speaker: speakerLabel,
        text: text2,
        startTime: startMs / 1e3,
        endTime: endMs / 1e3,
        language: getLanguageName(language)
      };
    } else {
      currentText += text2;
      currentSegment.text = currentText;
      currentSegment.endTime = endMs / 1e3;
    }
  }
  if (currentSegment) {
    segments.push(currentSegment);
  }
  return segments;
}
function extractLanguages(transcriptData) {
  const languages = /* @__PURE__ */ new Set();
  if (transcriptData.tokens) {
    for (const token of transcriptData.tokens) {
      if (token.language) {
        languages.add(getLanguageName(token.language));
      }
    }
  }
  return Array.from(languages);
}
function getLanguageName(code) {
  const languageMap = {
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
    fa: "Persian"
  };
  return languageMap[code] || code.toUpperCase();
}
function calculateDuration(transcriptData) {
  if (!transcriptData.tokens || transcriptData.tokens.length === 0) {
    return 0;
  }
  const lastToken = transcriptData.tokens[transcriptData.tokens.length - 1];
  return (lastToken.end_ms || 0) / 1e3;
}

// server/vite.ts
import express from "express";
import fs2 from "fs";
import path2 from "path";
import { createServer as createViteServer, createLogger } from "vite";

// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
var vite_config_default = defineConfig({
  plugins: [
    react()
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets")
    }
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          "react-vendor": ["react", "react-dom"],
          "router-vendor": ["wouter"],
          "query-vendor": ["@tanstack/react-query"],
          "ui-vendor": ["lucide-react"]
        }
      }
    },
    chunkSizeWarningLimit: 1e3
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"]
    }
  },
  optimizeDeps: {
    include: ["react", "react-dom", "wouter", "@tanstack/react-query"]
  }
});

// server/vite.ts
import { nanoid } from "nanoid";
var viteLogger = createLogger();
function log(message, source = "express") {
  const formattedTime = (/* @__PURE__ */ new Date()).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true
  });
  console.log(`${formattedTime} [${source}] ${message}`);
}
async function setupVite(app2, server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true
  };
  const vite = await createViteServer({
    ...vite_config_default,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        viteLogger.error(msg, options);
        process.exit(1);
      }
    },
    server: serverOptions,
    appType: "custom"
  });
  app2.use(vite.middlewares);
  app2.use("*", async (req, res, next) => {
    const url = req.originalUrl;
    try {
      const clientTemplate = path2.resolve(
        import.meta.dirname,
        "..",
        "client",
        "index.html"
      );
      let template = await fs2.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e);
      next(e);
    }
  });
}
function serveStatic(app2) {
  const distPath = path2.resolve(import.meta.dirname, "public");
  if (!fs2.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }
  app2.use(express.static(distPath));
  app2.use("*", (_req, res) => {
    res.sendFile(path2.resolve(distPath, "index.html"));
  });
}

// server/index.ts
var app = express2();
var ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "";
if (ALLOWED_ORIGIN) {
  const allowedOrigins = ALLOWED_ORIGIN.split(",").map((origin) => origin.trim());
  app.use(cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`Origin ${origin} not allowed by CORS`));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
  }));
  log(`CORS enabled for origins: ${allowedOrigins.join(", ")}`);
}
app.use(express2.json({
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express2.urlencoded({ extended: false }));
app.use((req, res, next) => {
  const start = Date.now();
  const path3 = req.path;
  let capturedJsonResponse = void 0;
  const originalResJson = res.json;
  res.json = function(bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };
  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path3.startsWith("/api")) {
      let logLine = `${req.method} ${path3} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "\u2026";
      }
      log(logLine);
    }
  });
  next();
});
(async () => {
  await storage.ensureAdminUser();
  log("[Bootstrap] Admin user ready");
  const server = await registerRoutes(app);
  app.use((err, _req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    res.status(status).json({ message });
    throw err;
  });
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }
  const port = parseInt(process.env.PORT || "5000", 10);
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true
  }, () => {
    log(`serving on port ${port}`);
  });
})();
