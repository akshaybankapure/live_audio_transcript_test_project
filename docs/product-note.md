# Product Note: Real-Time Group Discussion Monitor

## Problem Framing

**Context**: In Indian classrooms, teachers need to monitor multiple student groups (3-6 students per group) simultaneously during structured discussions. With 4-6 groups active at once in a noisy classroom environment, teachers cannot effectively:
- Listen to all groups simultaneously
- Identify inappropriate language or policy violations in real-time
- Track participation balance across group members
- Ensure groups stay on-topic

**Core Challenge**: Provide actionable, real-time signals to teachers about group discussion quality without requiring constant physical presence or manual monitoring.

**Solution Approach**: Use one smartphone per group to continuously listen, transcribe speech in real-time, and analyze content for four key signals: profanity, language policy violations, participation imbalances, and topic adherence.

## MVP Scope

### What the MVP Does

**Real-Time Monitoring**
- Live transcription with speaker diarization (identifies who said what)
- Immediate alerts for profanity and language policy violations via WebSocket
- Teacher dashboard showing all groups with live status and metrics
- Progressive auto-save of transcript segments during recording

**Content Analysis**
- **Profanity Detection**: Real-time detection using keyword matching with context
- **Language Policy**: Real-time detection of non-allowed languages (default: English-only)
- **Participation Balance**: End-of-session analysis identifying dominant speakers (>50% talk time) and silent participants (<5% talk time)
- **Topic Adherence**: End-of-session keyword-based analysis to detect off-topic drift

**Multi-Group Management**
- Device-based authentication (one device = one group)
- Teacher can monitor all groups from single dashboard
- Per-group statistics: session count, flag counts, topic adherence scores, activity timestamps
- Color-coded flag badges (red=profanity, orange=language, blue=participation, yellow=off-topic)

**User Interfaces**
- Group device UI: Simple start/stop recording, live transcript view with flag highlighting
- Teacher dashboard: Grid view of all groups, real-time alerts sidebar, device detail views
- Material Design 3 UI optimized for readability

### What the MVP Doesn't Do

**Not Included**
- Audio recording/playback (architecture planned but not implemented)
- Configurable topic keywords or prompts (uses default keyword lists)
- Custom participation thresholds per session (uses fixed thresholds)
- Semantic similarity analysis for topic detection (keyword-based only)
- Multi-language support beyond English detection (can detect but not analyze other languages)
- Real-time participation balance (requires full conversation context)
- Real-time topic adherence (requires full conversation context)
- User management or authentication beyond device-based sessions
- Export functionality for transcripts or reports
- Historical analytics or trend visualization
- Mobile app (web-based only, responsive design)

**Design Decisions**
- Profanity and language violations flagged immediately (actionable in real-time)
- Participation and topic analysis deferred to session end (requires full context)
- Simple keyword matching for speed and reliability (no ML models)
- Fixed thresholds for consistency across groups

