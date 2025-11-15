import {
  users,
  transcripts,
  flaggedContent,
  deviceIdentifiers,
  UserRole,
  type User,
  type UpsertUser,
  type Transcript,
  type InsertTranscript,
  type FlaggedContent,
  type InsertFlaggedContent,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, sql, like } from "drizzle-orm";

export interface DeviceOverview {
  userId: string;
  displayName: string | null;
  sessionCount: number;
  flagCount: number;
  flagBreakdown: {
    profanity: number;
    languagePolicy: number;
    offTopic: number;
    participation: number;
  };
  avgTopicAdherence: number | null; // Average topic adherence score across all sessions
  lastActivity: Date | null;
}

export interface DeviceDashboard {
  user: User;
  sessions: Transcript[];
  flaggedContent: Array<FlaggedContent & { transcript: Transcript }>;
}

export interface IStorage {
  // User operations
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  ensureAdminUser(): Promise<User>;
  
  // Device authentication operations (for development)
  findDeviceByHash(hashedDeviceId: string): Promise<User | undefined>;
  allocateDevice(hashedDeviceId: string): Promise<User>;
  
  // Transcript operations
  createTranscript(transcript: InsertTranscript): Promise<Transcript>;
  getTranscript(id: string): Promise<Transcript | undefined>;
  getTranscriptBySonioxJobId(sonioxJobId: string): Promise<Transcript | undefined>;
  getUserTranscripts(userId: string): Promise<Transcript[]>;
  appendSegments(transcriptId: string, newSegments: any[], fromIndex: number): Promise<Transcript>;
  updateProfanityCount(transcriptId: string, increment: number): Promise<Transcript>;
  updateLanguagePolicyViolations(transcriptId: string, increment: number): Promise<Transcript>;
  updateParticipationBalance(transcriptId: string, balance: any): Promise<Transcript>;
  updateTopicAdherence(transcriptId: string, score: number): Promise<Transcript>;
  updateTopicConfig(transcriptId: string, config: { topicPrompt?: string; topicKeywords?: string[] }): Promise<Transcript>;
  updateParticipationConfig(transcriptId: string, config: { dominanceThreshold?: number; silenceThreshold?: number }): Promise<Transcript>;
  completeTranscript(transcriptId: string, finalData: { duration?: number; audioFileUrl?: string }): Promise<Transcript>;
  
  // Flagged content operations
  createFlaggedContent(flagged: InsertFlaggedContent): Promise<FlaggedContent>;
  getTranscriptFlaggedContent(transcriptId: string): Promise<FlaggedContent[]>;
  getUserFlaggedContent(userId: string): Promise<Array<FlaggedContent & { transcript: Transcript }>>;
  
  // Dashboard operations
  getDashboardOverview(): Promise<DeviceOverview[]>;
  getDeviceDashboard(deviceId: string): Promise<DeviceDashboard | null>;
}

export class DatabaseStorage implements IStorage {
  // User operations
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...userData,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }

  async ensureAdminUser(): Promise<User> {
    // Use transaction to ensure atomicity and handle concurrent startups
    return await db.transaction(async (tx) => {
      // Check if an admin user already exists
      const [existingAdmin] = await tx
        .select()
        .from(users)
        .where(eq(users.role, UserRole.ADMIN))
        .limit(1);

      if (existingAdmin) {
        return existingAdmin;
      }

      // Create default admin user with conflict handling
      const [admin] = await tx
        .insert(users)
        .values({
          displayName: 'Admin',
          email: 'admin@local.dev',
          role: UserRole.ADMIN,
          firstName: 'Admin',
          lastName: 'User',
        })
        .onConflictDoUpdate({
          target: users.email,
          set: {
            role: UserRole.ADMIN, // Ensure role is admin even if user exists
          },
        })
        .returning();

      console.log('[Storage] Created/updated admin user:', admin.id);
      return admin;
    });
  }

  // Device authentication operations (for development)
  async findDeviceByHash(hashedDeviceId: string): Promise<User | undefined> {
    const [deviceRecord] = await db
      .select()
      .from(deviceIdentifiers)
      .where(eq(deviceIdentifiers.hashedDeviceId, hashedDeviceId))
      .limit(1);
    
    if (!deviceRecord) {
      return undefined;
    }

    return await this.getUser(deviceRecord.userId);
  }

  async allocateDevice(hashedDeviceId: string): Promise<User> {
    // Use transaction to ensure atomicity (number allocation + user creation + device linking)
    return await db.transaction(async (tx) => {
      // Lock the users table to prevent concurrent device creation races
      // Query max device number
      const result = await tx.execute<{ max_num: string | null }>(sql`
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
      const displayName = `Device_${nextNumber.toString().padStart(2, '0')}`;

      // Create user record for the device
      const [user] = await tx
        .insert(users)
        .values({
          displayName,
          email: null, // Devices don't have emails
          firstName: null,
          lastName: null,
          profileImageUrl: null,
        })
        .returning();

      // Link device identifier to user
      await tx
        .insert(deviceIdentifiers)
        .values({
          hashedDeviceId,
          userId: user.id,
        });

      return user;
    });
  }

  // Transcript operations
  async createTranscript(transcriptData: InsertTranscript): Promise<Transcript> {
    const [transcript] = await db
      .insert(transcripts)
      .values(transcriptData)
      .returning();
    return transcript;
  }

  async getTranscript(id: string): Promise<Transcript | undefined> {
    const [transcript] = await db
      .select()
      .from(transcripts)
      .where(eq(transcripts.id, id));
    return transcript;
  }

  async getTranscriptBySonioxJobId(sonioxJobId: string): Promise<Transcript | undefined> {
    const [transcript] = await db
      .select()
      .from(transcripts)
      .where(eq(transcripts.sonioxJobId, sonioxJobId));
    return transcript;
  }

  async getUserTranscripts(userId: string): Promise<Transcript[]> {
    return await db
      .select()
      .from(transcripts)
      .where(eq(transcripts.userId, userId))
      .orderBy(desc(transcripts.createdAt));
  }

  async appendSegments(transcriptId: string, newSegments: any[], fromIndex: number): Promise<Transcript> {
    // Atomic append using SQL that derives from current JSONB state
    // Cast to handle null values and ensure type compatibility
    const newSegmentsJson = JSON.stringify(newSegments);
    
    const [updated] = await db
      .update(transcripts)
      .set({
        // Atomically concatenate: COALESCE handles null, ${transcripts.segments} references column
        segments: sql`COALESCE(${transcripts.segments}, '[]'::jsonb) || ${newSegmentsJson}::jsonb`,
        // Atomically calculate new index from concatenated result
        lastSegmentIdx: sql`jsonb_array_length(COALESCE(${transcripts.segments}, '[]'::jsonb) || ${newSegmentsJson}::jsonb)`,
        updatedAt: new Date(),
      })
      .where(
        sql`${transcripts.id} = ${transcriptId} AND ${transcripts.lastSegmentIdx} = ${fromIndex}`
      )
      .returning();

    // If no rows updated, index mismatch occurred
    if (!updated) {
      // Fetch current state to provide helpful error message
      const freshTranscript = await db
        .select()
        .from(transcripts)
        .where(eq(transcripts.id, transcriptId))
        .limit(1);
      
      const current = freshTranscript[0];
      throw new Error(`Index mismatch: expected ${fromIndex}, got ${current?.lastSegmentIdx ?? 'unknown'}`);
    }

    return updated;
  }

  async updateProfanityCount(transcriptId: string, increment: number): Promise<Transcript> {
    // Use atomic SQL increment to prevent race conditions
    const [updated] = await db
      .update(transcripts)
      .set({
        profanityCount: sql`COALESCE(${transcripts.profanityCount}, 0) + ${increment}`,
        updatedAt: new Date(),
      })
      .where(eq(transcripts.id, transcriptId))
      .returning();

    if (!updated) {
      throw new Error('Transcript not found');
    }

    return updated;
  }

  async updateLanguagePolicyViolations(transcriptId: string, increment: number): Promise<Transcript> {
    const [updated] = await db
      .update(transcripts)
      .set({
        languagePolicyViolations: sql`COALESCE(${transcripts.languagePolicyViolations}, 0) + ${increment}`,
        updatedAt: new Date(),
      })
      .where(eq(transcripts.id, transcriptId))
      .returning();

    if (!updated) {
      throw new Error('Transcript not found');
    }

    return updated;
  }

  async updateParticipationBalance(transcriptId: string, balance: any): Promise<Transcript> {
    const [updated] = await db
      .update(transcripts)
      .set({
        participationBalance: balance,
        updatedAt: new Date(),
      })
      .where(eq(transcripts.id, transcriptId))
      .returning();

    if (!updated) {
      throw new Error('Transcript not found');
    }

    return updated;
  }

  async updateTopicAdherence(transcriptId: string, score: number): Promise<Transcript> {
    const [updated] = await db
      .update(transcripts)
      .set({
        topicAdherenceScore: score,
        updatedAt: new Date(),
      })
      .where(eq(transcripts.id, transcriptId))
      .returning();

    if (!updated) {
      throw new Error('Transcript not found');
    }

    return updated;
  }

  async updateTopicConfig(transcriptId: string, config: { topicPrompt?: string; topicKeywords?: string[] }): Promise<Transcript> {
    const [updated] = await db
      .update(transcripts)
      .set({
        topicPrompt: config.topicPrompt,
        topicKeywords: config.topicKeywords,
        updatedAt: new Date(),
      })
      .where(eq(transcripts.id, transcriptId))
      .returning();

    if (!updated) {
      throw new Error('Transcript not found');
    }

    return updated;
  }

  async updateParticipationConfig(transcriptId: string, config: { dominanceThreshold?: number; silenceThreshold?: number }): Promise<Transcript> {
    const [updated] = await db
      .update(transcripts)
      .set({
        participationConfig: config,
        updatedAt: new Date(),
      })
      .where(eq(transcripts.id, transcriptId))
      .returning();

    if (!updated) {
      throw new Error('Transcript not found');
    }

    return updated;
  }

  async completeTranscript(transcriptId: string, finalData: { duration?: number; audioFileUrl?: string }): Promise<Transcript> {
    const [updated] = await db
      .update(transcripts)
      .set({
        status: 'complete',
        duration: finalData.duration,
        audioFileUrl: finalData.audioFileUrl,
        updatedAt: new Date(),
      })
      .where(eq(transcripts.id, transcriptId))
      .returning();

    if (!updated) {
      throw new Error('Transcript not found');
    }

    return updated;
  }

  // Flagged content operations
  async createFlaggedContent(flaggedData: InsertFlaggedContent): Promise<FlaggedContent> {
    const [flagged] = await db
      .insert(flaggedContent)
      .values(flaggedData)
      .returning();
    return flagged;
  }

  async getTranscriptFlaggedContent(transcriptId: string): Promise<FlaggedContent[]> {
    return await db
      .select()
      .from(flaggedContent)
      .where(eq(flaggedContent.transcriptId, transcriptId))
      .orderBy(flaggedContent.timestampMs);
  }

  async getUserFlaggedContent(userId: string): Promise<Array<FlaggedContent & { transcript: Transcript }>> {
    const results = await db
      .select()
      .from(flaggedContent)
      .innerJoin(transcripts, eq(flaggedContent.transcriptId, transcripts.id))
      .where(eq(transcripts.userId, userId))
      .orderBy(desc(flaggedContent.createdAt));
    
    return results.map(row => ({
      ...row.flagged_content,
      transcript: row.transcripts,
    }));
  }

  // Dashboard operations
  async getDashboardOverview(options?: {
    timeRange?: 'live' | 'all' | 'custom' | '1h' | '12h' | 'today' | 'session';
    startDate?: Date;
    endDate?: Date;
    transcriptId?: string;
  }): Promise<DeviceOverview[]> {
    const { timeRange = 'live', startDate, endDate, transcriptId } = options || {};
    
    // Build date filter conditions
    let dateFilter = sql`1=1`; // Default: no filter
    if (timeRange === 'live') {
      // Last 24 hours
      dateFilter = sql`t.created_at >= NOW() - INTERVAL '24 hours'`;
    } else if (timeRange === '1h') {
      // Last 1 hour
      dateFilter = sql`t.created_at >= NOW() - INTERVAL '1 hour'`;
    } else if (timeRange === '12h') {
      // Last 12 hours
      dateFilter = sql`t.created_at >= NOW() - INTERVAL '12 hours'`;
    } else if (timeRange === 'today') {
      // Today (start of today to now)
      dateFilter = sql`t.created_at >= DATE_TRUNC('day', NOW())`;
    } else if (timeRange === 'custom' && startDate && endDate) {
      // Custom date range - include full end date (end of day)
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      dateFilter = sql`t.created_at >= ${start} AND t.created_at <= ${end}`;
    }
    // 'all' time range: no date filter
    
    // Build transcript ID filter if specified
    let transcriptFilter = sql`1=1`;
    if (transcriptId) {
      transcriptFilter = sql`t.id = ${transcriptId}`;
    }
    // Optimized query using CTEs with flag breakdown by type and topic adherence
    const results = await db.execute<{
      user_id: string;
      display_name: string | null;
      session_count: string;
      flag_count: string;
      profanity_count: string;
      language_policy_count: string;
      off_topic_count: string;
      participation_count: string;
      avg_topic_adherence: number | null;
      last_activity: Date | null;
    }>(sql`
      WITH transcript_stats AS (
        SELECT 
          user_id,
          COUNT(*)::int as session_count,
          AVG(topic_adherence_score) as avg_topic_adherence,
          MAX(created_at) as last_activity
        FROM ${transcripts} t
        WHERE status = 'complete' AND ${dateFilter} AND ${transcriptFilter}
        GROUP BY user_id
      ),
      flag_stats AS (
        SELECT 
          t.user_id,
          COUNT(*)::int as flag_count,
          COUNT(*) FILTER (WHERE fc.flag_type = 'profanity')::int as profanity_count,
          COUNT(*) FILTER (WHERE fc.flag_type = 'language_policy')::int as language_policy_count,
          COUNT(*) FILTER (WHERE fc.flag_type = 'off_topic')::int as off_topic_count,
          COUNT(*) FILTER (WHERE fc.flag_type = 'participation')::int as participation_count
        FROM ${flaggedContent} fc
        INNER JOIN ${transcripts} t ON fc.transcript_id = t.id
        WHERE ${dateFilter} AND ${transcriptFilter}
        GROUP BY t.user_id
      )
      SELECT 
        u.id as user_id,
        u.display_name,
        COALESCE(ts.session_count, 0) as session_count,
        COALESCE(fs.flag_count, 0) as flag_count,
        COALESCE(fs.profanity_count, 0) as profanity_count,
        COALESCE(fs.language_policy_count, 0) as language_policy_count,
        COALESCE(fs.off_topic_count, 0) as off_topic_count,
        COALESCE(fs.participation_count, 0) as participation_count,
        ts.avg_topic_adherence,
        ts.last_activity
      FROM ${users} u
      LEFT JOIN transcript_stats ts ON u.id = ts.user_id
      LEFT JOIN flag_stats fs ON u.id = fs.user_id
      ORDER BY ts.last_activity DESC NULLS LAST, u.created_at DESC
    `);

    return results.rows.map(row => ({
      userId: row.user_id,
      displayName: row.display_name,
      sessionCount: parseInt(row.session_count || '0', 10),
      flagCount: parseInt(row.flag_count || '0', 10),
      flagBreakdown: {
        profanity: parseInt(row.profanity_count || '0', 10),
        languagePolicy: parseInt(row.language_policy_count || '0', 10),
        offTopic: parseInt(row.off_topic_count || '0', 10),
        participation: parseInt(row.participation_count || '0', 10),
      },
      avgTopicAdherence: row.avg_topic_adherence,
      lastActivity: row.last_activity,
    }));
  }

  async getDeviceDashboard(deviceId: string): Promise<DeviceDashboard | null> {
    // Get user info
    const user = await this.getUser(deviceId);
    if (!user) {
      return null;
    }

    // Get all sessions (transcripts) for this device
    const sessions = await this.getUserTranscripts(deviceId);

    // Get all flagged content for this device
    const flaggedContent = await this.getUserFlaggedContent(deviceId);

    return {
      user,
      sessions,
      flaggedContent,
    };
  }
}

export const storage = new DatabaseStorage();
