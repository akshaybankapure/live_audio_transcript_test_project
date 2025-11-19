# Technical Note: Real-Time Group Discussion Monitor

## Architecture

```
┌─────────────┐
│   Browser   │  (Group Device)
│  (React)    │
│             │
│  Soniox SDK │───WebSocket───┐
│  (Stream)   │                │
└─────────────┘                │
                                ▼
                        ┌───────────────┐
                        │  Node.js      │
                        │  Express      │
                        │  Server       │
                        └───────────────┘
                                │
                ┌───────────────┼───────────────┐
                │               │               │
                ▼               ▼               ▼
        ┌───────────┐   ┌───────────┐   ┌───────────┐
        │  Soniox   │   │ PostgreSQL│   │ WebSocket │
        │   API     │   │  Database │   │  Service  │
        └───────────┘   └───────────┘   └───────────┘
                                │
                                ▼
                        ┌───────────────┐
                        │   Browser     │  (Teacher)
                        │   (React)     │
                        │   Dashboard   │
                        └───────────────┘
```

**Components**:
- **Frontend**: React 18 + TypeScript, TanStack Query for data fetching, Wouter for routing
- **Backend**: Node.js + Express, Drizzle ORM, PostgreSQL database
- **Real-time**: WebSocket (ws library) for bidirectional communication
- **ASR**: Soniox API for speech-to-text and speaker diarization
- **Storage**: PostgreSQL (Neon) for transcripts, users, flagged content

## Key Technical Decisions

### Audio Streaming

**Approach**: Browser MediaRecorder API captures audio stream, shared between Soniox SDK and (future) MediaRecorder for recording.

**Implementation**:
- Single `getUserMedia()` stream shared between transcription and recording
- Soniox Web SDK receives audio stream directly via WebSocket
- Real-time transcription: `stt-rt-preview` model with speaker diarization enabled
- Tokens streamed incrementally: partial results for UI updates, final tokens for persistence

**Why**: Direct browser-to-Soniox streaming minimizes latency (<500ms) and avoids server audio processing overhead. Shared stream ensures transcription and recording use identical audio source.

### API/Model Selection

**Soniox API** (`stt-rt-preview` for live, `stt-async-preview` for file uploads)

**Why Soniox**:
- Real-time streaming API with WebSocket support
- Built-in speaker diarization (identifies "Speaker 1", "Speaker 2", etc.)
- Language identification support
- Low latency (<500ms for partial results)
- Good accuracy for conversational speech
- Reasonable pricing for MVP scale

**Alternatives Considered**:
- **Deepgram**: More expensive, similar features
- **AssemblyAI**: No real-time streaming in free tier
- **Google Speech-to-Text**: Higher latency, more complex setup
- **Whisper**: No real-time API, requires self-hosting

### Alert Computation

**Real-Time Alerts** (Profanity, Language Policy):
1. Soniox streams tokens to browser via WebSocket
2. Browser processes tokens, creates segments grouped by speaker
3. Segments sent to server via `/api/transcripts/:id/segments` (PATCH)
4. Server analyzes each segment:
   - **Profanity**: Keyword matching against profanity list with context window
   - **Language Policy**: Unicode range detection for non-English characters (Devanagari, Arabic, Chinese, etc.)
5. Flags inserted into database, WebSocket alert broadcast to all connected teachers
6. Client-side cache invalidation triggers UI update

**End-of-Session Alerts** (Participation, Topic Adherence):
1. When transcript marked `complete`, server fetches final transcript from Soniox
2. All segments analyzed together:
   - **Participation**: Calculate talk time per speaker, flag if >50% (dominant) or <5% (silent)
   - **Topic Adherence**: Keyword matching against topic keywords vs. off-topic indicators, calculate score (0-1)
3. Flags created for violations, stored in database
4. Dashboard refreshes to show new flags

**Why This Split**: Real-time alerts (profanity, language) are actionable immediately. Participation and topic analysis require full conversation context to be meaningful.

### Token Processing & Segment Accumulation

**Challenge**: Soniox sends tokens incrementally, may refine tokens with same time range but better text.

**Solution**:
- Deduplicate tokens using key: `${startMs}_${endMs}_${speaker}`
- Sort tokens chronologically by `start_ms` then `end_ms`
- Group sequential tokens by speaker into segments
- When same speaker continues, update last segment (not create new one)
- Prevents fragmentation and ensures complete sentences

## Known Limitations & Production Improvements

### Current Limitations

1. **Profanity Detection**: Keyword-based only, no context understanding
   - **Improvement**: Use ML model (e.g., Perspective API) or fine-tuned classifier

2. **Topic Adherence**: Simple keyword matching, no semantic understanding
   - **Improvement**: Use embeddings (OpenAI, Cohere) for semantic similarity to topic prompt

3. **Participation Thresholds**: Fixed at 50% (dominant) and 5% (silent)
   - **Improvement**: Configurable per session, adaptive based on group size

4. **No Audio Recording**: Architecture planned but not implemented
   - **Improvement**: Implement chunked MediaRecorder upload, server-side concatenation

5. **Single Language Analysis**: Only English content analyzed for topic/profanity
   - **Improvement**: Multi-language support with language-specific analyzers

6. **No Rate Limiting**: API endpoints not rate-limited
   - **Improvement**: Add rate limiting per device/user to prevent abuse

7. **Cache Invalidation**: Manual invalidation on updates, may miss edge cases
   - **Improvement**: Event-driven cache invalidation, TTL-based expiration

8. **Error Recovery**: Limited retry logic for failed segment saves
   - **Improvement**: Queue-based retry with exponential backoff, dead letter queue

9. **Scalability**: Single server instance, no horizontal scaling
   - **Improvement**: Stateless server design, Redis for WebSocket session management, load balancer

10. **Monitoring**: Basic console logging only
    - **Improvement**: Structured logging (Winston/Pino), metrics (Prometheus), APM (DataDog/New Relic)

