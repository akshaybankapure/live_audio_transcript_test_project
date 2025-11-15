import { detectProfanity, type ProfanityDetection } from "./profanityDetector";
import { detectLanguagePolicyViolations, type LanguagePolicyDetection } from "./languagePolicyDetector";
import { analyzeParticipationBalance, type ParticipationBalance, type ParticipationConfig } from "./participationAnalyzer";
import { analyzeTopicAdherence, type TopicAdherenceResult, type TopicAdherenceConfig } from "./topicAdherenceDetector";
import { qualityLogger } from "./qualityLogger";
import type { TranscriptSegment, InsertFlaggedContent } from "@shared/schema";

export interface ContentAnalysisResult {
  profanity: ProfanityDetection;
  languagePolicy: LanguagePolicyDetection;
  participation: ParticipationBalance;
  topicAdherence: TopicAdherenceResult;
  allFlaggedItems: InsertFlaggedContent[];
}

/**
 * Analyze participation for a segment based on all current segments
 * Flags segments from dominant speakers or silent speakers
 */
function analyzeSegmentParticipation(
  segment: TranscriptSegment,
  allSegments: TranscriptSegment[],
  transcriptId: string,
  config?: ParticipationConfig
): InsertFlaggedContent[] {
  const participationFlags: InsertFlaggedContent[] = [];

  if (allSegments.length === 0) {
    return participationFlags;
  }

  // Calculate talk time per speaker
  const speakerStats = new Map<string, { talkTime: number; segmentCount: number }>();
  
  for (const seg of allSegments) {
    const speakerId = seg.speaker;
    const duration = seg.endTime - seg.startTime;
    
    const existing = speakerStats.get(speakerId) || { talkTime: 0, segmentCount: 0 };
    speakerStats.set(speakerId, {
      talkTime: existing.talkTime + duration,
      segmentCount: existing.segmentCount + 1,
    });
  }

  // Calculate total talk time
  const totalTalkTime = Array.from(speakerStats.values()).reduce(
    (sum, stat) => sum + stat.talkTime,
    0
  );

  if (totalTalkTime === 0) {
    return participationFlags;
  }

  // Check if this segment's speaker is dominant or silent
  const segmentSpeakerStats = speakerStats.get(segment.speaker);
  if (!segmentSpeakerStats) {
    return participationFlags;
  }

  const speakerPercentage = segmentSpeakerStats.talkTime / totalTalkTime;
  const startTimeMs = segment.startTime * 1000;

  const DOMINANCE_THRESHOLD = config?.dominanceThreshold ?? 0.5;
  const SILENCE_THRESHOLD = config?.silenceThreshold ?? 0.05;

  // Flag if speaker is dominating (>threshold% of talk time)
  if (speakerPercentage > DOMINANCE_THRESHOLD) {
    participationFlags.push({
      transcriptId,
      flaggedWord: 'participation_dominance',
      context: segment.text.substring(0, 150),
      timestampMs: Math.floor(startTimeMs),
      speaker: segment.speaker,
      flagType: 'participation',
    });
  }

  // Flag if speaker is silent (<threshold% of talk time) but has spoken
  // Only flag if there are at least 3 speakers to avoid false positives in small groups
  if (speakerStats.size >= 3 && speakerPercentage < SILENCE_THRESHOLD && segmentSpeakerStats.segmentCount > 0) {
    participationFlags.push({
      transcriptId,
      flaggedWord: 'participation_silence',
      context: segment.text.substring(0, 150),
      timestampMs: Math.floor(startTimeMs),
      speaker: segment.speaker,
      flagType: 'participation',
    });
  }

  return participationFlags;
}

/**
 * Analyze a single segment for real-time flagging
 * This processes each segment individually as it comes in
 */
export function analyzeSegment(
  segment: TranscriptSegment,
  transcriptId: string,
  allowedLanguage: string = 'en',
  allSegments?: TranscriptSegment[], // Optional: all segments for participation analysis
  topicConfig?: TopicAdherenceConfig,
  participationConfig?: ParticipationConfig
): {
  profanity: InsertFlaggedContent[];
  languagePolicy: InsertFlaggedContent[];
  offTopic: InsertFlaggedContent[];
  participation: InsertFlaggedContent[];
} {
  const profanityItems: InsertFlaggedContent[] = [];
  const languageItems: InsertFlaggedContent[] = [];
  const offTopicItems: InsertFlaggedContent[] = [];

  // Check profanity in this segment using the profanity detector
  const profanityResult = detectProfanity([segment], transcriptId);
  profanityItems.push(...profanityResult.flaggedItems);

  // Check language policy violation
  const startTimeMs = segment.startTime * 1000;
  if (segment.language && segment.language.toLowerCase() !== allowedLanguage.toLowerCase()) {
    languageItems.push({
      transcriptId,
      flaggedWord: segment.language,
      context: segment.text.substring(0, 100),
      timestampMs: Math.floor(startTimeMs),
      speaker: segment.speaker,
      flagType: 'language_policy',
    });
  }

  // Check off-topic using topic config if provided
  const topicKeywords = topicConfig?.topicKeywords || [
    'discuss', 'discussion', 'topic', 'question', 'answer', 'think', 'opinion',
    'agree', 'disagree', 'why', 'how', 'what', 'explain', 'understand',
    'learn', 'study', 'class', 'lesson', 'subject', 'idea', 'point',
  ];
  const OFF_TOPIC_INDICATORS = [
    'game', 'play', 'fun', 'bored', 'tired', 'hungry', 'lunch', 'break',
    'homework', 'test', 'exam', 'grade', 'teacher', 'school', 'friend',
    'phone', 'video', 'movie', 'music', 'song', 'dance',
  ];

  const text = segment.text.toLowerCase();
  const segmentWords = text.split(/\s+/);
  let hasTopicKeyword = false;
  let hasOffTopicIndicators = false;

  const normalizedTopicKeywords = topicKeywords.map(k => k.toLowerCase());

  for (const word of segmentWords) {
    const cleanWord = word.replace(/[^\w]/g, '');
    if (normalizedTopicKeywords.includes(cleanWord)) {
      hasTopicKeyword = true;
    }
    if (OFF_TOPIC_INDICATORS.map(k => k.toLowerCase()).includes(cleanWord)) {
      hasOffTopicIndicators = true;
    }
  }

  // Flag as off-topic if no topic keywords and has off-topic indicators
  if (!hasTopicKeyword && hasOffTopicIndicators) {
    offTopicItems.push({
      transcriptId,
      flaggedWord: 'off_topic',
      context: segment.text.substring(0, 150),
      timestampMs: Math.floor(startTimeMs),
      speaker: segment.speaker,
      flagType: 'off_topic',
    });
  }

  // Analyze participation if all segments are provided
  let participationItems: InsertFlaggedContent[] = [];
  if (allSegments && allSegments.length > 0) {
    participationItems = analyzeSegmentParticipation(segment, allSegments, transcriptId, participationConfig);
  }

  return {
    profanity: profanityItems,
    languagePolicy: languageItems,
    offTopic: offTopicItems,
    participation: participationItems,
  };
}

/**
 * Comprehensive content analysis combining all detectors
 * This is the main entry point for analyzing group discussion transcripts
 */
export async function analyzeContent(
  segments: TranscriptSegment[],
  transcriptId: string,
  allowedLanguage: string = 'en',
  topicConfig?: TopicAdherenceConfig,
  participationConfig?: ParticipationConfig
): Promise<ContentAnalysisResult> {
  // Run all detectors in parallel
  const [profanity, languagePolicy, participation, topicAdherence] = await Promise.all([
    Promise.resolve(detectProfanity(segments, transcriptId)),
    Promise.resolve(detectLanguagePolicyViolations(segments, transcriptId, allowedLanguage)),
    Promise.resolve(analyzeParticipationBalance(segments, participationConfig)),
    Promise.resolve(analyzeTopicAdherence(segments, transcriptId, topicConfig)),
  ]);

  // Combine all flagged items
  const allFlaggedItems: InsertFlaggedContent[] = [
    ...profanity.flaggedItems,
    ...languagePolicy.violations,
    ...topicAdherence.offTopicSegments,
  ];

  // Log detection decisions for observability
  if (profanity.hasProfanity) {
    await qualityLogger.logDetectionDecision(transcriptId, 'profanity_detected', {
      count: profanity.flaggedItems.length,
      words: profanity.flaggedItems.map(f => f.flaggedWord),
    });
  }

  if (languagePolicy.hasViolations) {
    await qualityLogger.logDetectionDecision(transcriptId, 'language_policy_violation', {
      count: languagePolicy.violations.length,
      detectedLanguages: Array.from(new Set(languagePolicy.violations.map(v => v.flaggedWord))).sort(),
      allowedLanguage,
    });
  }

  if (!participation.isBalanced) {
    await qualityLogger.logDetectionDecision(transcriptId, 'participation_imbalance', {
      dominantSpeaker: participation.dominantSpeaker,
      silentSpeakers: participation.silentSpeakers,
      reason: participation.imbalanceReason,
    });
  }

  if (topicAdherence.score < 0.7) {
    await qualityLogger.logDetectionDecision(transcriptId, 'low_topic_adherence', {
      score: topicAdherence.score,
      offTopicCount: topicAdherence.offTopicSegments.length,
    });
  }

  // Log quality metrics
  await qualityLogger.logQualityMetric(transcriptId, 'participation_balance', {
    speakers: participation.speakers,
    isBalanced: participation.isBalanced,
  });

  await qualityLogger.logQualityMetric(transcriptId, 'topic_adherence_score', topicAdherence.score, {
    detectedKeywords: topicAdherence.detectedKeywords,
    offTopicIndicators: topicAdherence.offTopicIndicators,
  });

  return {
    profanity,
    languagePolicy,
    participation,
    topicAdherence,
    allFlaggedItems,
  };
}

