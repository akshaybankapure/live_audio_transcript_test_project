# Metrics Implementation Guide

## Overview

The system implements two key metrics for analyzing group discussions:
1. **Participation Balance** - Detects if one voice dominates or if some voices are silent
2. **Topic Adherence** - Detects if the group is drifting off-topic from the given prompt

## 1. Participation Balance

### Current Implementation

**Location:** `server/participationAnalyzer.ts`

**How it works:**
1. Calculates total talk time per speaker by summing segment durations
2. Calculates percentage of total talk time for each speaker
3. Identifies issues:
   - **Dominant Speaker**: Any speaker with >50% of talk time
   - **Silent Speakers**: Speakers with <5% of talk time (but have spoken at least once)

**Thresholds:**
- `DOMINANCE_THRESHOLD = 0.5` (50%)
- `SILENCE_THRESHOLD = 0.05` (5%)

**Output:**
```typescript
{
  speakers: [
    { speakerId: "SPEAKER 1", talkTime: 120, segmentCount: 15, percentage: 0.6 },
    { speakerId: "SPEAKER 2", talkTime: 60, segmentCount: 8, percentage: 0.3 },
    { speakerId: "SPEAKER 3", talkTime: 20, segmentCount: 2, percentage: 0.1 }
  ],
  isBalanced: false,
  dominantSpeaker: "SPEAKER 1",
  silentSpeakers: [],
  imbalanceReason: "SPEAKER 1 dominates with 60% of talk time"
}
```

## 2. Topic Adherence

### Current Implementation

**Location:** `server/topicAdherenceDetector.ts`

**How it works:**
1. Uses keyword matching (simple approach)
2. Has default topic keywords (e.g., "discuss", "question", "opinion")
3. Has off-topic indicators (e.g., "game", "bored", "phone")
4. Flags segments as off-topic if:
   - No topic keywords found AND has off-topic indicators
   - OR has multiple off-topic indicators

**Current Keywords:**
```typescript
DEFAULT_TOPIC_KEYWORDS = [
  'discuss', 'discussion', 'topic', 'question', 'answer', 'think', 'opinion',
  'agree', 'disagree', 'why', 'how', 'what', 'explain', 'understand',
  'learn', 'study', 'class', 'lesson', 'subject', 'idea', 'point',
];

OFF_TOPIC_INDICATORS = [
  'game', 'play', 'fun', 'bored', 'tired', 'hungry', 'lunch', 'break',
  'homework', 'test', 'exam', 'grade', 'teacher', 'school', 'friend',
  'phone', 'video', 'movie', 'music', 'song', 'dance',
];
```

**Output:**
```typescript
{
  score: 0.75, // 0-1, where 1 is fully on-topic
  offTopicSegments: [...], // Array of flagged segments
  detectedKeywords: ['discuss', 'question', 'opinion'],
  offTopicIndicators: ['game', 'phone']
}
```

## Flag Types and Color Coding

The system implements **4 flag types** with consistent color coding throughout the application:

1. **Profanity** (Red - High Critical)
   - Color: Red (`destructive` variant)
   - Icon: `AlertTriangle`
   - Detected: Real-time during live transcription
   - Highlighting: Red background in transcript text

2. **Language Policy** (Orange - Low Critical)
   - Color: Orange
   - Icon: `Languages`
   - Detected: Real-time during live transcription
   - Highlighting: Orange background for non-allowed language words
   - Default: English-only policy (configurable via `ALLOWED_LANGUAGE` env var)

3. **Participation** (Blue - Low Critical)
   - Color: Blue
   - Icon: `UserX`
   - Detected: At session end (requires full conversation context)
   - Flags: Dominant speakers (>threshold% talk time) and silent speakers (<threshold% talk time)

4. **Off-Topic** (Yellow - Not Critical unless outside acceptable range)
   - Color: Yellow
   - Icon: `MessageSquareX`
   - Detected: At session end (requires full conversation context)
   - Flags: Segments that drift significantly from the discussion topic

**Centralized Configuration**: All flag types use a shared configuration system (`client/src/lib/flagConfig.ts`) for consistent styling across:
- Dashboard cards
- Live recording panel
- Transcript segments
- Device details view
- Flag lists

## Real-Time vs End-of-Session Analysis

### Real-Time Flagging (During Live Recording)
- **Profanity**: Detected immediately as segments arrive
- **Language Policy**: Detected immediately when non-allowed language is detected
- **WebSocket Alerts**: Broadcast immediately for profanity and language violations
- **UI Updates**: Flags appear in transcript with color-coded highlighting

### End-of-Session Analysis (After Recording Completes)
- **Participation Balance**: Requires full conversation context to calculate percentages
- **Topic Adherence**: Requires full conversation context to assess overall topic drift
- **Analysis Trigger**: Automatically runs when transcript is marked as `complete`
- **Flag Creation**: Creates flags for participation imbalances and off-topic segments

## Current Usage in Codebase

- **Participation Balance**: Calculated in `analyzeContent()` and stored in `participationBalance` field
- **Topic Adherence**: Calculated in `analyzeContent()` and stored in `topicAdherenceScore` field
- **Flag Display**: All 4 flag types shown with color-coded badges in:
  - Dashboard device cards
  - Live recording panel
  - Transcript segments
  - Device details view
- **Real-Time Alerts**: WebSocket broadcasts for profanity and language policy violations
- **Cache Invalidation**: Dashboard cache invalidated when transcripts are created/updated for real-time updates

## Token Processing and Segment Accumulation

### Progressive Segment Saving
- Segments are saved incrementally during live recording
- When the same speaker continues, the last segment is **updated** (not duplicated)
- This prevents transcript fragmentation and ensures complete sentences
- Implementation: `server/storage.ts::appendSegments()` with `updateLastIfSameSpeaker` logic

### Token Deduplication
- Final tokens are deduplicated using a Set with key: `${startMs}_${endMs}_${speaker}_${text}`
- Tokens are sorted chronologically by `start_ms` then `end_ms`
- Segments are created by grouping sequential tokens by speaker
- Text is accumulated by concatenating `token.text` directly (Soniox handles spacing)
