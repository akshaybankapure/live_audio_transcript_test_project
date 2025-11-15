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

### Improvements & Enhancements

#### Option 1: Configurable Thresholds
Allow teachers to set custom thresholds per session:

```typescript
interface ParticipationConfig {
  dominanceThreshold?: number; // Default: 0.5
  silenceThreshold?: number;   // Default: 0.05
  minSpeakers?: number;        // Minimum speakers to analyze
}

export function analyzeParticipationBalance(
  segments: TranscriptSegment[],
  config?: ParticipationConfig
): ParticipationBalance {
  const DOMINANCE_THRESHOLD = config?.dominanceThreshold ?? 0.5;
  const SILENCE_THRESHOLD = config?.silenceThreshold ?? 0.05;
  // ... rest of implementation
}
```

#### Option 2: Time-Based Analysis
Track participation over time to identify when imbalance occurs:

```typescript
interface TimeWindow {
  startTime: number;
  endTime: number;
  participation: ParticipationBalance;
}

export function analyzeParticipationOverTime(
  segments: TranscriptSegment[],
  windowSize: number = 60 // seconds
): TimeWindow[] {
  // Split segments into time windows and analyze each
}
```

#### Option 3: Turn-Taking Analysis
Analyze turn-taking patterns (not just total time):

```typescript
interface TurnTakingMetrics {
  averageTurnLength: number;
  turnCount: number;
  interruptions: number;
  responseTime: number; // Time between speakers
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

### Improvements & Enhancements

#### Option 1: Configurable Topic Keywords (Recommended)
Allow teachers to set topic keywords per session:

```typescript
// Add to transcript schema
export const transcripts = pgTable("transcripts", {
  // ... existing fields
  topicKeywords: jsonb("topic_keywords"), // Array of keywords
  topicPrompt: text("topic_prompt"), // The original prompt/question
});

// Update detector
export function analyzeTopicAdherence(
  segments: TranscriptSegment[],
  transcriptId: string,
  topicKeywords?: string[], // From transcript
  topicPrompt?: string      // For semantic analysis
): TopicAdherenceResult {
  const keywords = topicKeywords || DEFAULT_TOPIC_KEYWORDS;
  // ... rest of implementation
}
```

#### Option 2: Semantic Similarity (Advanced)
Use embeddings/LLM for better topic detection:

```typescript
import { OpenAI } from 'openai';

export async function analyzeTopicAdherenceSemantic(
  segments: TranscriptSegment[],
  topicPrompt: string
): Promise<TopicAdherenceResult> {
  const openai = new OpenAI();
  
  // Get embedding for topic prompt
  const promptEmbedding = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: topicPrompt,
  });
  
  // Analyze each segment
  for (const segment of segments) {
    const segmentEmbedding = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: segment.text,
    });
    
    // Calculate cosine similarity
    const similarity = cosineSimilarity(
      promptEmbedding.data[0].embedding,
      segmentEmbedding.data[0].embedding
    );
    
    // Flag if similarity < threshold (e.g., 0.7)
    if (similarity < 0.7) {
      // Flag as off-topic
    }
  }
}
```

#### Option 3: Hybrid Approach (Recommended for MVP)
Combine keyword matching with simple semantic checks:

```typescript
export function analyzeTopicAdherenceHybrid(
  segments: TranscriptSegment[],
  transcriptId: string,
  topicKeywords: string[],
  topicPrompt?: string
): TopicAdherenceResult {
  // 1. Keyword matching (fast, good for common words)
  const keywordResult = analyzeTopicAdherence(segments, transcriptId, topicKeywords);
  
  // 2. Simple semantic checks (for longer segments)
  // - Check if segment contains topic-related phrases
  // - Use word frequency analysis
  // - Check for topic-related questions
  
  // 3. Combine results
  return {
    score: (keywordResult.score * 0.7) + (semanticScore * 0.3),
    offTopicSegments: [...keywordResult.offTopicSegments, ...semanticOffTopic],
    // ...
  };
}
```

#### Option 4: Context-Aware Analysis
Consider conversation flow and context:

```typescript
export function analyzeTopicAdherenceContextual(
  segments: TranscriptSegment[],
  topicPrompt: string
): TopicAdherenceResult {
  // Track conversation flow
  let topicMomentum = 1.0; // Starts high
  
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const previousSegments = segments.slice(Math.max(0, i - 3), i);
    
    // Check if segment continues topic from previous segments
    const contextualScore = checkContextualRelevance(
      segment,
      previousSegments,
      topicPrompt
    );
    
    // Adjust momentum based on recent segments
    topicMomentum = (topicMomentum * 0.8) + (contextualScore * 0.2);
    
    // Flag if momentum drops too low
    if (topicMomentum < 0.5) {
      // Flag as off-topic
    }
  }
}
```

## Implementation Recommendations

### Phase 1: Make It Configurable (Quick Win)
1. Add `topicKeywords` and `topicPrompt` fields to transcript schema
2. Update `analyzeTopicAdherence` to accept custom keywords
3. Add UI for teachers to set topic keywords when creating/starting a session

### Phase 2: Improve Detection (Medium Effort)
1. Implement hybrid approach (keyword + simple semantic)
2. Add conversation flow tracking
3. Improve off-topic indicator detection

### Phase 3: Advanced Features (Long Term)
1. Integrate LLM/embeddings for semantic similarity
2. Add machine learning model for topic classification
3. Implement real-time topic drift detection

## Database Schema Updates Needed

```typescript
// Add to transcripts table
export const transcripts = pgTable("transcripts", {
  // ... existing fields
  topicPrompt: text("topic_prompt"), // The discussion prompt/question
  topicKeywords: jsonb("topic_keywords"), // Custom keywords for this session
  participationConfig: jsonb("participation_config"), // Custom thresholds
});
```

## API Endpoints to Add

```typescript
// Set topic for a session
app.post("/api/transcripts/:id/topic", isAuthenticated, async (req, res) => {
  const { topicPrompt, topicKeywords } = req.body;
  await storage.updateTranscript(id, { topicPrompt, topicKeywords });
});

// Get participation config
app.get("/api/transcripts/:id/participation-config", isAuthenticated, async (req, res) => {
  const config = await storage.getParticipationConfig(id);
  res.json(config);
});

// Set participation config
app.post("/api/transcripts/:id/participation-config", isAuthenticated, async (req, res) => {
  const { dominanceThreshold, silenceThreshold } = req.body;
  await storage.updateParticipationConfig(id, { dominanceThreshold, silenceThreshold });
});
```

## UI Components Needed

1. **Topic Setup Form** - When starting a session, allow teacher to:
   - Enter the discussion prompt/question
   - Add custom topic keywords
   - Set participation thresholds

2. **Metrics Dashboard** - Display:
   - Participation balance visualization (pie chart, bar chart)
   - Topic adherence score with trend over time
   - Speaker participation timeline
   - Off-topic segments highlighted in transcript

3. **Real-time Alerts** - Show warnings when:
   - One speaker dominates
   - Topic drifts significantly
   - Silent speakers detected

## Current Usage in Codebase

- **Participation Balance**: Calculated in `analyzeContent()` and stored in `participationBalance` field
- **Topic Adherence**: Calculated in `analyzeContent()` and stored in `topicAdherenceScore` field
- **Display**: Shown in `DeviceDetails.tsx` with speaker analytics cards
- **Alerts**: Broadcast via WebSocket when thresholds are exceeded

## Next Steps

1. ✅ Basic implementation (DONE)
2. ⏳ Make topic keywords configurable
3. ⏳ Add topic prompt field to schema
4. ⏳ Improve topic detection algorithm
5. ⏳ Add visualization components
6. ⏳ Add real-time metrics dashboard

