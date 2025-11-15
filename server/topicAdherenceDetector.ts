import type { TranscriptSegment, InsertFlaggedContent } from "@shared/schema";

// Topic keywords - in a real system, this would be configurable per discussion
// For MVP: Simple keyword matching approach
const DEFAULT_TOPIC_KEYWORDS = [
  'discuss', 'discussion', 'topic', 'question', 'answer', 'think', 'opinion',
  'agree', 'disagree', 'why', 'how', 'what', 'explain', 'understand',
  'learn', 'study', 'class', 'lesson', 'subject', 'idea', 'point',
];

// Off-topic indicators (words that suggest conversation is drifting)
const OFF_TOPIC_INDICATORS = [
  'game', 'play', 'fun', 'bored', 'tired', 'hungry', 'lunch', 'break',
  'homework', 'test', 'exam', 'grade', 'teacher', 'school', 'friend',
  'phone', 'video', 'movie', 'music', 'song', 'dance',
];

export interface TopicAdherenceResult {
  score: number; // 0-1, where 1 is fully on-topic
  offTopicSegments: InsertFlaggedContent[];
  detectedKeywords: string[];
  offTopicIndicators: string[];
}

export interface TopicAdherenceConfig {
  topicKeywords?: string[];
  topicPrompt?: string;
  offTopicIndicators?: string[];
}

/**
 * Analyzes topic adherence using keyword matching
 * For MVP: Simple keyword-based approach
 * In production: Would use semantic similarity or LLM-based analysis
 */
export function analyzeTopicAdherence(
  segments: TranscriptSegment[],
  transcriptId: string,
  config?: TopicAdherenceConfig
): TopicAdherenceResult {
  const topicKeywords = config?.topicKeywords || DEFAULT_TOPIC_KEYWORDS;
  const offTopicIndicators = config?.offTopicIndicators || OFF_TOPIC_INDICATORS;
  const topicPrompt = config?.topicPrompt;
  if (segments.length === 0) {
    return {
      score: 1.0,
      offTopicSegments: [],
      detectedKeywords: [],
      offTopicIndicators: [],
    };
  }

  const detectedKeywords = new Set<string>();
  const offTopicIndicatorsFound = new Set<string>();
  const offTopicSegments: InsertFlaggedContent[] = [];
  let onTopicCount = 0;
  let offTopicCount = 0;

  // Normalize keywords for matching
  const normalizedTopicKeywords = topicKeywords.map(k => k.toLowerCase());
  const normalizedOffTopicIndicators = offTopicIndicators.map(k => k.toLowerCase());

  for (const segment of segments) {
    const text = segment.text.toLowerCase();
    const words = text.split(/\s+/);
    
    // Check for topic keywords
    let hasTopicKeyword = false;
    for (const word of words) {
      const cleanWord = word.replace(/[^\w]/g, '');
      if (normalizedTopicKeywords.includes(cleanWord)) {
        detectedKeywords.add(cleanWord);
        hasTopicKeyword = true;
      }
      
      // Check for off-topic indicators
      if (normalizedOffTopicIndicators.includes(cleanWord)) {
        offTopicIndicatorsFound.add(cleanWord);
      }
    }

    // Segment is considered off-topic if:
    // 1. No topic keywords found AND has off-topic indicators
    // 2. OR has multiple off-topic indicators
    const hasOffTopicIndicators = Array.from(offTopicIndicatorsFound).some(indicator =>
      text.includes(indicator)
    );

    if (!hasTopicKeyword && hasOffTopicIndicators) {
      offTopicCount++;
      const startTimeMs = segment.startTime * 1000;
      
      offTopicSegments.push({
        transcriptId,
        flaggedWord: 'off_topic',
        context: segment.text.substring(0, 150),
        timestampMs: Math.floor(startTimeMs),
        speaker: segment.speaker,
        flagType: 'off_topic',
      });
    } else {
      onTopicCount++;
    }
  }

  // Calculate score: ratio of on-topic segments
  const totalSegments = segments.length;
  const score = totalSegments > 0 ? onTopicCount / totalSegments : 1.0;

  return {
    score,
    offTopicSegments,
    detectedKeywords: Array.from(detectedKeywords),
    offTopicIndicators: Array.from(offTopicIndicatorsFound),
  };
}

