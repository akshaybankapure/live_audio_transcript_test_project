# Audio Capture Architecture - Phase 2 Implementation Plan

## Overview
This document outlines the architecture for capturing, storing, and serving audio snippets for flagged content and full session recordings in the Audio Transcript Viewer application.

## Database Schema

### Existing Tables (Completed)

#### Transcripts Table
- `sessionAudioObjectPath`: Nullable string storing GCS path to full session audio recording
  - Example: `audio/sessions/user123/session456/recording.webm`

#### Flagged Content Table
- `snippetObjectPath`: Nullable string storing GCS path to extracted audio snippet
- `snippetStartMs`: Nullable integer storing snippet start time in milliseconds
- `snippetEndMs`: Nullable integer storing snippet end time in milliseconds
  - Example: `audio/snippets/user123/session456/snippet-12345.webm`

### New Tables Required for Phase 2

#### Audio Chunks Table
```typescript
export const audioChunks = pgTable("audio_chunks", {
  id: serial("id").primaryKey(),
  transcriptId: integer("transcript_id").notNull().references(() => transcripts.id, { onDelete: "cascade" }),
  chunkSequence: integer("chunk_sequence").notNull(), // 0, 1, 2...
  objectPath: varchar("object_path", { length: 500 }).notNull(), // GCS path to chunk
  uploadConfirmedAt: timestamp("upload_confirmed_at"), // NULL = pending, timestamp = confirmed
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
```

**Purpose:**
- Persistent tracking of uploaded chunks
- Distinguishes pending uploads from confirmed uploads
- Enables recovery after server restarts
- Validates chunk completeness before concatenation
- Cascade delete when transcript deleted

**Lifecycle:**
1. Created with `uploadConfirmedAt = NULL` when chunk upload URL requested
2. Updated with `uploadConfirmedAt = NOW()` when client confirms successful upload
3. Read during concatenation job (only confirmed chunks)
4. Deleted after successful concatenation

**Client Confirmation Flow:**
```typescript
// 1. Request upload URL
POST /api/transcripts/:id/upload-chunk
Response: { uploadUrl, chunkId }

// 2. Upload chunk to GCS using presigned URL
PUT {uploadUrl} (binary data)

// 3. Confirm upload completed
POST /api/transcripts/:id/confirm-chunk
Body: { chunkId }
→ Sets uploadConfirmedAt = NOW()
```

#### Background Jobs Table
```typescript
export const backgroundJobs = pgTable("background_jobs", {
  id: serial("id").primaryKey(),
  jobType: varchar("job_type", { length: 50 }).notNull(), // "CONCATENATE_CHUNKS", "EXTRACT_SNIPPET", "CLEANUP_AUDIO"
  status: varchar("status", { length: 20 }).notNull().default("pending"), // "pending", "processing", "completed", "failed"
  payload: jsonb("payload").notNull(), // { transcriptId: 123 } or { flaggedContentId: 456 }
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  retryAt: timestamp("retry_at"), // NULL = ready to process, timestamp = wait until this time
  error: text("error"), // Last error message if failed
  createdAt: timestamp("created_at").notNull().defaultNow(),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
});
```

**Purpose:**
- Durable job queue with retry logic
- Survives server restarts
- Enables job status monitoring
- Automatic retry with exponential backoff (enforced via `retryAt`)

**Retry Delay Schedule:**
- Attempt 1: Immediate (retryAt = NULL)
- Attempt 2: 5 seconds delay (retryAt = NOW() + 5s)
- Attempt 3: 25 seconds delay (retryAt = NOW() + 25s)
- After 3 attempts: Marked as "failed"

## Phase 2: Audio Capture Implementation

### 1. Frontend: MediaRecorder Integration

#### getUserMedia Stream Sharing
```typescript
// Share single stream between Soniox and MediaRecorder
const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

// For Soniox transcription
const sonioxClient = new SonioxClient({ stream });

// For audio recording
const mediaRecorder = new MediaRecorder(stream, {
  mimeType: 'audio/webm;codecs=opus',
  audioBitsPerSecond: 128000
});
```

**Benefits:**
- Single microphone permission request
- Consistent audio source for both transcription and recording
- Reduced resource usage

#### Chunked Recording Strategy
- **Chunk Duration**: 10-15 seconds
- **Format**: WebM container with Opus codec (best browser support)
- **Upload**: Progressive upload during recording using presigned URLs
- **Storage**: Temporary chunks → final concatenation on server

**Implementation Flow:**
1. Start recording on session start
2. `mediaRecorder.ondataavailable` fires every 10-15s
3. Upload chunk to GCS via presigned URL
4. Server tracks chunk sequence for later concatenation
5. On session completion, server concatenates chunks → final audio file

#### Error Handling
- Browser compatibility checks for MediaRecorder
- Graceful degradation if audio recording not supported
- Retry logic for failed chunk uploads
- Recovery from network interruptions

### 2. Backend: Audio Processing

#### Chunk Upload Endpoint
```typescript
POST /api/transcripts/:id/upload-chunk
- Body: { chunkSequence: number }
- Returns: { uploadUrl: string, chunkId: number }
```

**Process:**
1. Validate user owns transcript
2. Generate object path: `audio/sessions/{userId}/{transcriptId}/chunks/chunk-{sequence}.webm`
3. Insert record into `audio_chunks` table
4. Generate presigned upload URL using existing `objectStorage.generateUploadUrl()`
5. Return upload URL and chunk ID to client

**Integration with Google Cloud Storage:**
```typescript
import { objectStorage } from './objectStorage';

const chunkPath = `audio/sessions/${userId}/${transcriptId}/chunks/chunk-${sequence}.webm`;
const uploadUrl = await objectStorage.generateUploadUrl(chunkPath, 'audio/webm');

// Track in database
await db.insert(audioChunks).values({
  transcriptId,
  chunkSequence: sequence,
  objectPath: chunkPath,
});
```

#### Session Finalization
```typescript
POST /api/transcripts/:id/finalize-audio
- Process: Queue concatenation job
- Returns: { jobId: number, status: "pending" }
```

**Process:**
1. Validate user owns transcript
2. Query `audio_chunks` table for all chunks (ordered by sequence)
3. Create background job:
```typescript
await db.insert(backgroundJobs).values({
  jobType: "CONCATENATE_CHUNKS",
  status: "pending",
  payload: { transcriptId: id },
});
```
4. Return job ID for status polling

**Job Processor (Background Worker):**
```typescript
async function processConcatenateJob(job: BackgroundJob) {
  const { transcriptId } = job.payload;
  
  // 1. Fetch transcript to get userId for storage path
  const transcript = await db
    .select()
    .from(transcripts)
    .where(eq(transcripts.id, transcriptId))
    .limit(1);
  
  if (transcript.length === 0) {
    throw new Error(`Transcript ${transcriptId} not found`);
  }
  
  const { userId } = transcript[0];
  
  // 2. Fetch all confirmed chunks from database
  const chunks = await db
    .select()
    .from(audioChunks)
    .where(and(
      eq(audioChunks.transcriptId, transcriptId),
      isNotNull(audioChunks.uploadConfirmedAt) // Only confirmed chunks
    ))
    .orderBy(audioChunks.chunkSequence);
  
  if (chunks.length === 0) {
    throw new Error(`No confirmed chunks found for transcript ${transcriptId}`);
  }
  
  // 3. Download chunks from object storage
  const tempDir = `/tmp/concat-${transcriptId}`;
  await fs.mkdir(tempDir, { recursive: true });
  
  for (const chunk of chunks) {
    const url = await objectStorage.getDownloadUrl(chunk.objectPath);
    await downloadFile(url, `${tempDir}/chunk-${chunk.chunkSequence}.webm`);
  }
  
  // 4. Concatenate using ffmpeg
  const outputPath = `${tempDir}/final.webm`;
  await ffmpegConcatenate(
    chunks.map(c => `${tempDir}/chunk-${c.chunkSequence}.webm`), 
    outputPath
  );
  
  // 5. Upload final file to object storage
  const finalPath = `audio/sessions/${userId}/${transcriptId}/recording.webm`;
  await objectStorage.uploadFile(finalPath, outputPath, 'audio/webm');
  
  // 6. Update transcript record with audio path
  await db
    .update(transcripts)
    .set({ sessionAudioObjectPath: finalPath })
    .where(eq(transcripts.id, transcriptId));
  
  // 7. Delete chunks from object storage
  for (const chunk of chunks) {
    await objectStorage.deleteFile(chunk.objectPath);
  }
  
  // 8. Delete chunk records from database
  await db.delete(audioChunks).where(eq(audioChunks.transcriptId, transcriptId));
  
  // 9. Cleanup temp files
  await fs.rm(tempDir, { recursive: true });
}
```

#### Snippet Extraction (ffmpeg)
```typescript
POST /api/flagged-content/:id/extract-snippet
- Background job triggered when flagged content created
- Extract audio segment: startMs - 5s to endMs + 5s (context)
- Store snippet with metadata
```

**Process:**
1. Load full session audio from GCS
2. Calculate extraction window (context ± 5s)
3. Extract using ffmpeg: `-ss {start} -t {duration}`
4. Upload snippet to GCS
5. Update flagged_content record with snippet metadata

**ffmpeg Command:**
```bash
ffmpeg -i session-audio.webm -ss {startSeconds} -t {durationSeconds} -c copy snippet.webm
```

### 3. Object Storage Structure

```
audio/
  sessions/
    {userId}/
      {sessionId}/
        recording.webm              # Full session audio
        chunks/                      # Temporary chunks (deleted after concat)
          chunk-001.webm
          chunk-002.webm
  snippets/
    {userId}/
      {sessionId}/
        snippet-{flagId}.webm        # Individual flagged snippets
```

**ACL Configuration:**
- Private: All audio files require presigned URLs
- User isolation: Path includes userId for security
- Expiring URLs: 1-hour expiration for playback

### 4. Frontend: Audio Playback UI

#### Session Audio Player
- Location: Dashboard device detail drawer, Sessions tab
- Controls: Play/pause, seek, speed controls
- Display: Waveform visualization (optional)
- Integration: Sync with transcript segments (click to jump)

#### Snippet Audio Player
- Location: Dashboard device detail drawer, Flags tab
- Auto-load: Fetch snippet when flag expanded
- Context indicator: Visual marker for flagged portion
- Playback: Highlight corresponding text during playback

### 5. Security & Privacy

#### User Consent
- Clear microphone permission request
- Privacy notice for audio recording
- Option to disable audio capture (transcription only mode)
- Data retention policy display

#### Access Control
- Audio files stored with private ACL
- Presigned URLs for time-limited access
- User ownership validation on all endpoints
- No shared audio access between users

#### Data Retention
- Session audio: Configurable retention (default 30 days)
- Snippets: Tied to flagged content lifecycle
- Automatic cleanup job for expired audio

### 6. Background Processing

#### Job Queue Implementation

**Technology Choice: Database-Backed Job Queue**
- Uses `background_jobs` table for persistence
- Polling-based worker (simple, reliable, no external dependencies)
- Retry logic with exponential backoff
- Job status tracking for UI feedback

**Worker Process:**
```typescript
// server/backgroundWorker.ts
class BackgroundWorker {
  private isRunning = false;
  
  async start() {
    this.isRunning = true;
    while (this.isRunning) {
      await this.processNextJob();
      await sleep(1000); // Poll every second
    }
  }
  
  async processNextJob() {
    // Atomic job claim using transaction
    const job = await db.transaction(async (tx) => {
      const now = new Date();
      const pending = await tx
        .select()
        .from(backgroundJobs)
        .where(and(
          eq(backgroundJobs.status, "pending"),
          lt(backgroundJobs.attempts, backgroundJobs.maxAttempts),
          or(
            isNull(backgroundJobs.retryAt),           // Ready immediately
            lte(backgroundJobs.retryAt, now)          // Or retry time has passed
          )
        ))
        .orderBy(backgroundJobs.createdAt)
        .limit(1);
      
      if (pending.length === 0) return null;
      
      // Mark as processing
      await tx
        .update(backgroundJobs)
        .set({ 
          status: "processing", 
          startedAt: new Date(),
          attempts: pending[0].attempts + 1 
        })
        .where(eq(backgroundJobs.id, pending[0].id));
      
      return pending[0];
    });
    
    if (!job) return;
    
    try {
      // Process based on job type
      switch (job.jobType) {
        case "CONCATENATE_CHUNKS":
          await this.processConcatenateJob(job);
          break;
        case "EXTRACT_SNIPPET":
          await this.processExtractSnippetJob(job);
          break;
        case "CLEANUP_AUDIO":
          await this.processCleanupJob(job);
          break;
      }
      
      // Mark completed
      await db
        .update(backgroundJobs)
        .set({ status: "completed", completedAt: new Date() })
        .where(eq(backgroundJobs.id, job.id));
        
    } catch (error) {
      // Calculate exponential backoff delay
      const delays = [0, 5000, 25000]; // 0s, 5s, 25s in milliseconds
      const delay = delays[job.attempts] || 0;
      const retryAt = delay > 0 ? new Date(Date.now() + delay) : null;
      
      const isFinalAttempt = job.attempts >= job.maxAttempts - 1;
      
      await db
        .update(backgroundJobs)
        .set({ 
          status: isFinalAttempt ? "failed" : "pending",
          retryAt: isFinalAttempt ? null : retryAt,
          error: error.message 
        })
        .where(eq(backgroundJobs.id, job.id));
      
      console.error(`Job ${job.id} failed (attempt ${job.attempts}):`, error);
    }
  }
}

// Start worker when server starts
const worker = new BackgroundWorker();
worker.start();
```

**Retry Strategy:**
- Immediate retry for first failure
- Exponential backoff: 5s, 25s, 125s
- Max 3 attempts before marking as failed
- Failed jobs require manual intervention or cleanup

**Job Types:**

1. **CONCATENATE_CHUNKS**
   - Payload: `{ transcriptId: number }`
   - Triggered: When client calls `/api/transcripts/:id/finalize-audio`
   - Process: Download chunks → concatenate → upload final → cleanup

2. **EXTRACT_SNIPPET**
   - Payload: `{ flaggedContentId: number }`
   - Triggered: When flagged content created
   - Process: Download session audio → extract snippet → upload

3. **CLEANUP_AUDIO**
   - Payload: `{ retentionDays: number }`
   - Triggered: Daily cron job
   - Process: Find expired audio → delete from storage → update DB

#### Integration with Existing Object Storage

**Google Cloud Storage Wrapper (`server/objectStorage.ts`):**

The existing `objectStorage` module already provides:
```typescript
interface ObjectStorage {
  generateUploadUrl(path: string, contentType: string): Promise<string>;
  getDownloadUrl(path: string, expiresIn?: number): Promise<string>;
  deleteFile(path: string): Promise<void>;
  uploadFile(path: string, localFilePath: string, contentType: string): Promise<void>;
}
```

**Audio-Specific Adaptations:**
```typescript
// server/audioStorage.ts
import { objectStorage } from './objectStorage';

export class AudioStorage {
  // Generate upload URL for chunk
  async getChunkUploadUrl(userId: string, transcriptId: number, sequence: number) {
    const path = `audio/sessions/${userId}/${transcriptId}/chunks/chunk-${sequence}.webm`;
    return objectStorage.generateUploadUrl(path, 'audio/webm');
  }
  
  // Generate download URL for session audio
  async getSessionAudioUrl(sessionAudioPath: string) {
    return objectStorage.getDownloadUrl(sessionAudioPath, 3600); // 1 hour expiry
  }
  
  // Upload concatenated session audio
  async uploadSessionAudio(userId: string, transcriptId: number, localPath: string) {
    const remotePath = `audio/sessions/${userId}/${transcriptId}/recording.webm`;
    await objectStorage.uploadFile(remotePath, localPath, 'audio/webm');
    return remotePath;
  }
  
  // Delete chunk
  async deleteChunk(chunkPath: string) {
    await objectStorage.deleteFile(chunkPath);
  }
}
```

**Local Development Fallback:**

The existing `objectStorage.ts` already handles local development:
- Development: Uses local file system under `./storage/`
- Production: Uses Google Cloud Storage
- Same API for both environments
- No code changes needed in audio implementation

#### Processing Flow
1. Client uploads final chunk → Queue concatenation job in `background_jobs` table
2. Background worker picks up job → Concatenates chunks → Updates transcript
3. Concatenation completes → Queue snippet extraction jobs for all associated flags
4. Worker processes snippet jobs → Extracts and uploads snippets
5. Daily cron job → Queues cleanup job → Removes expired audio

### 7. Progressive Enhancement Strategy

#### Minimum Viable Audio (MVA)
- Phase 2.1: Full session recording only
- Phase 2.2: Add snippet extraction
- Phase 2.3: Add playback UI with seek
- Phase 2.4: Add waveform visualization

#### Graceful Degradation
- Transcript functionality works without audio
- Audio recording optional (can be disabled)
- Browser compatibility detection
- Fallback UI when audio unavailable

## Implementation Checklist

### Phase 2.1: Session Recording
- [ ] Add MediaRecorder to LiveRecordingPanel
- [ ] Implement chunked upload (10-15s)
- [ ] Create chunk upload endpoint
- [ ] Build chunk concatenation service (ffmpeg)
- [ ] Update transcript with audio path on completion
- [ ] Test: Record session → verify audio stored

### Phase 2.2: Snippet Extraction
- [ ] Create background job system
- [ ] Implement snippet extraction service (ffmpeg)
- [ ] Queue snippet jobs when flagged content created
- [ ] Update flagged_content with snippet metadata
- [ ] Test: Create flag → verify snippet extracted

### Phase 2.3: Playback UI
- [ ] Add audio player to Sessions tab
- [ ] Add audio player to Flags tab
- [ ] Implement presigned URL fetching
- [ ] Add playback controls (play/pause/seek)
- [ ] Test: Playback in both locations

### Phase 2.4: Advanced Features
- [ ] Waveform visualization
- [ ] Transcript-audio sync (click segment → jump to time)
- [ ] Speed controls (0.5x, 1x, 1.5x, 2x)
- [ ] Download audio option
- [ ] Test: All advanced features

## Technical Dependencies

### npm Packages
- `fluent-ffmpeg`: Node.js wrapper for ffmpeg
- Optional: `wavesurfer.js` for waveform visualization

### System Dependencies
- `ffmpeg`: Audio processing (concatenation, extraction)
- Requires installation in your environment

### Browser APIs
- `MediaRecorder`: Audio capture
- `AudioContext`: Optional waveform analysis

## Performance Considerations

### Upload Optimization
- 10-15s chunks balance upload frequency vs. failure recovery
- Parallel uploads if network allows
- Progress indicators for user feedback

### Storage Costs
- WebM/Opus efficient compression (~1MB per minute)
- Automatic cleanup reduces long-term storage
- User-configurable retention policies

### Processing Time
- Concatenation: ~1s per 5 minutes of audio
- Snippet extraction: <1s per snippet
- Background jobs prevent UI blocking

## Testing Strategy

### Unit Tests
- Chunk sequence validation
- ffmpeg command generation
- Presigned URL generation
- ACL policy enforcement

### Integration Tests
- Full recording flow (upload → concat → store)
- Snippet extraction pipeline
- Cleanup job execution
- Error recovery scenarios

### E2E Tests (Playwright)
- Record session with audio enabled
- Verify audio playback in dashboard
- Test snippet playback for flagged content
- Browser compatibility (Chrome, Firefox, Safari)

## Migration Notes

### Database
- Schema already updated (sessionAudioObjectPath, snippet fields)
- No migration needed - nullable fields allow gradual rollout

### Backwards Compatibility
- Existing sessions without audio continue to work
- Audio capture opt-in with feature flag
- Graceful handling of missing audio files

## Future Enhancements

### Advanced Audio Features
- Speaker identification via audio analysis
- Noise reduction / enhancement
- Multi-track recording for multi-speaker scenarios
- Real-time audio level monitoring

### Analytics
- Audio quality metrics
- Storage usage dashboard
- Playback statistics
- User engagement with audio features

### Export Options
- Download session audio with timestamps
- Export with embedded transcript (subtitle format)
- Share audio clips with timestamp links
