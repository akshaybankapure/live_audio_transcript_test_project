import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  varchar,
  timestamp,
  jsonb,
  index,
  integer,
  boolean,
  real,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Session storage table
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// User roles
export const UserRole = {
  USER: 'user',
  ADMIN: 'admin',
} as const;

export type Role = typeof UserRole[keyof typeof UserRole];

// User storage table (represents both real users and devices)
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  displayName: varchar("display_name"), // For devices: Device_01, Device_02, etc.
  role: varchar("role").notNull().default('user'), // 'user' or 'admin'
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;

// Device identifiers table - stores hashed device IDs for dev auth
export const deviceIdentifiers = pgTable("device_identifiers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  hashedDeviceId: varchar("hashed_device_id").notNull().unique(),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp("created_at").defaultNow(),
});

export type DeviceIdentifier = typeof deviceIdentifiers.$inferSelect;

// Transcripts table - stores audio transcriptions
export const transcripts = pgTable(
  "transcripts",
  {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  sonioxJobId: varchar("soniox_job_id"), // Soniox job ID for uploaded files
  title: varchar("title").notNull(),
  audioFileUrl: varchar("audio_file_url"), // URL to the stored audio file (uploaded files)
  sessionAudioObjectPath: varchar("session_audio_object_path"), // Object path to full session audio (live recordings)
  duration: real("duration"), // Duration in seconds
  source: varchar("source").notNull(), // 'upload' or 'live'
  language: varchar("language"),
  segments: jsonb("segments").notNull(), // Array of TranscriptSegment
  status: varchar("status").notNull().default('draft'), // 'draft' or 'complete'
  lastSegmentIdx: integer("last_segment_idx").notNull().default(0), // Index for incremental appends
  profanityCount: integer("profanity_count").notNull().default(0), // Quick summary for UI
  languagePolicyViolations: integer("language_policy_violations").notNull().default(0), // Count of non-allowed language usage
  participationBalance: jsonb("participation_balance"), // { speakerId: { talkTime: number, percentage: number } }
  topicAdherenceScore: real("topic_adherence_score"), // 0-1 score, null if not calculated yet
  topicPrompt: text("topic_prompt"), // The discussion prompt/question for this session
  topicKeywords: jsonb("topic_keywords"), // Custom topic keywords array for this session
  participationConfig: jsonb("participation_config"), // { dominanceThreshold?: number, silenceThreshold?: number }
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("IDX_transcripts_user_id").on(table.userId),
    index("IDX_transcripts_created_at").on(table.createdAt),
    index("IDX_transcripts_soniox_job_id").on(table.sonioxJobId),
  ]
);

export const insertTranscriptSchema = createInsertSchema(transcripts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastSegmentIdx: true,
  profanityCount: true,
});

export type InsertTranscript = z.infer<typeof insertTranscriptSchema>;
export type Transcript = typeof transcripts.$inferSelect;

// Flagged content table - stores profanity/inappropriate content flags
export const flaggedContent = pgTable(
  "flagged_content",
  {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  transcriptId: varchar("transcript_id").notNull().references(() => transcripts.id, { onDelete: 'cascade' }),
  flaggedWord: varchar("flagged_word").notNull(),
  context: text("context"), // Surrounding text for context
  timestampMs: integer("timestamp_ms").notNull(), // Timestamp in milliseconds
  speaker: varchar("speaker"),
  flagType: varchar("flag_type").notNull().default('profanity'), // 'profanity', 'language_policy', 'off_topic'
  snippetObjectPath: varchar("snippet_object_path"), // Object path to audio snippet with context
  snippetStartMs: integer("snippet_start_ms"), // Start time of snippet in milliseconds
  snippetEndMs: integer("snippet_end_ms"), // End time of snippet in milliseconds
  createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("IDX_flagged_content_transcript_id").on(table.transcriptId),
    index("IDX_flagged_content_created_at").on(table.createdAt),
    index("IDX_flagged_content_flag_type").on(table.flagType),
  ]
);

export const insertFlaggedContentSchema = createInsertSchema(flaggedContent).omit({
  id: true,
  createdAt: true,
});

export type InsertFlaggedContent = z.infer<typeof insertFlaggedContentSchema>;
export type FlaggedContent = typeof flaggedContent.$inferSelect;

export interface TranscriptWord {
  text: string;
  startTime: number;
  endTime: number;
  confidence?: number;
}

export interface TranscriptSegment {
  speaker: string;
  text: string;
  startTime: number;
  endTime: number;
  language?: string;
  words?: TranscriptWord[];
}

export interface Transcription {
  id: string;
  filename: string;
  duration: number;
  segments: TranscriptSegment[];
  languages: string[];
  status: 'processing' | 'completed' | 'error';
}

// Quality/observability logging table
export const qualityLogs = pgTable("quality_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  transcriptId: varchar("transcript_id").notNull().references(() => transcripts.id, { onDelete: 'cascade' }),
  logType: varchar("log_type").notNull(), // 'detection_decision', 'quality_metric', 'alert_triggered'
  metadata: jsonb("metadata").notNull(), // Flexible JSON for different log types
  createdAt: timestamp("created_at").defaultNow(),
});

export type QualityLog = typeof qualityLogs.$inferSelect;
