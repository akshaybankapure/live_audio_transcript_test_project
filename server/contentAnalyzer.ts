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
 * Only flags when a speaker FIRST crosses a threshold to avoid duplicate flags
 * Uses a Set to track which speakers have already been flagged
 */
function analyzeSegmentParticipation(
  segment: TranscriptSegment,
  allSegments: TranscriptSegment[],
  transcriptId: string,
  config?: ParticipationConfig,
  alreadyFlagged?: Set<string> // Track speakers already flagged to avoid duplicates
): InsertFlaggedContent[] {
  const participationFlags: InsertFlaggedContent[] = [];
  const flagged = alreadyFlagged || new Set<string>();

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

  // Calculate dynamic thresholds based on number of speakers
  const numberOfSpeakers = speakerStats.size;
  const fairShare = numberOfSpeakers > 0 ? 1 / numberOfSpeakers : 1;
  
  // Use custom thresholds if provided, otherwise calculate dynamic thresholds
  const DOMINANCE_THRESHOLD = config?.dominanceThreshold ?? (fairShare * 1.5); // Default: 1.5x fair share
  const SILENCE_THRESHOLD = config?.silenceThreshold ?? (fairShare * 0.3); // Default: 0.3x fair share
  
  // Cap thresholds at reasonable limits
  const finalDominanceThreshold = Math.min(DOMINANCE_THRESHOLD, 0.6); // Never flag below 60% as dominant
  const finalSilenceThreshold = Math.max(SILENCE_THRESHOLD, 0.05); // Never flag above 5% as silent

  // Flag if speaker is dominating (>threshold% of talk time)
  // Only flag if there are at least 2 speakers (can't dominate a solo conversation)
  // Only flag ONCE per speaker to avoid duplicate flags
  const dominanceKey = `${segment.speaker}_dominance`;
  if (numberOfSpeakers >= 2 && speakerPercentage > finalDominanceThreshold && !flagged.has(dominanceKey)) {
    participationFlags.push({
      transcriptId,
      flaggedWord: 'participation_dominance',
      context: segment.text.substring(0, 150),
      timestampMs: Math.floor(startTimeMs),
      speaker: segment.speaker,
      flagType: 'participation',
    });
    flagged.add(dominanceKey);
  }

  // Flag if speaker is silent (<threshold% of talk time) but has spoken
  // Only flag if there are at least 3 speakers to avoid false positives in small groups
  // Only flag ONCE per speaker to avoid duplicate flags
  const silenceKey = `${segment.speaker}_silence`;
  if (numberOfSpeakers >= 3 && speakerPercentage < finalSilenceThreshold && segmentSpeakerStats.segmentCount > 0 && !flagged.has(silenceKey)) {
    participationFlags.push({
      transcriptId,
      flaggedWord: 'participation_silence',
      context: segment.text.substring(0, 150),
      timestampMs: Math.floor(startTimeMs),
      speaker: segment.speaker,
      flagType: 'participation',
    });
    flagged.add(silenceKey);
  }

  return participationFlags;
}

/**
 * Analyze a single segment for real-time flagging
 * This processes each segment individually as it comes in during live recording
 * 
 * NOTE: Only profanity and language policy are flagged in real-time.
 * Topic adherence and participation are analyzed only at the end of the session
 * since they require full conversation context.
 */
export function analyzeSegment(
  segment: TranscriptSegment,
  transcriptId: string,
  allowedLanguage: string = 'en',
  allSegments?: TranscriptSegment[], // Not used for real-time analysis
  topicConfig?: TopicAdherenceConfig, // Not used for real-time analysis
  participationConfig?: ParticipationConfig // Not used for real-time analysis
): {
  profanity: InsertFlaggedContent[];
  languagePolicy: InsertFlaggedContent[];
  offTopic: InsertFlaggedContent[]; // Empty - only analyzed at session end
  participation: InsertFlaggedContent[]; // Empty - only analyzed at session end
} {
  const profanityItems: InsertFlaggedContent[] = [];
  const languageItems: InsertFlaggedContent[] = [];

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

  // Topic adherence and participation are NOT analyzed in real-time
  // They require full conversation context and are analyzed only when the session is completed
  // This prevents false positives and ensures accurate analysis

  return {
    profanity: profanityItems,
    languagePolicy: languageItems,
    offTopic: [], // Only analyzed at session end
    participation: [], // Only analyzed at session end
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

  // Create participation flags at session end (one per speaker issue, not per segment)
  const participationFlags: InsertFlaggedContent[] = [];
  if (!participation.isBalanced) {
    // Create one flag for dominant speaker if detected
    if (participation.dominantSpeaker) {
      const dominant = participation.speakers.find(s => s.speakerId === participation.dominantSpeaker);
      // Use the first segment from the dominant speaker as context
      const dominantSegment = segments.find(s => s.speaker === participation.dominantSpeaker);
      if (dominantSegment) {
        participationFlags.push({
          transcriptId,
          flaggedWord: 'participation_dominance',
          context: dominantSegment.text.substring(0, 150),
          timestampMs: Math.floor(dominantSegment.startTime * 1000),
          speaker: participation.dominantSpeaker,
          flagType: 'participation',
        });
      }
    }

    // Create one flag per silent speaker if detected
    for (const silentSpeakerId of participation.silentSpeakers) {
      // Use the first segment from the silent speaker as context
      const silentSegment = segments.find(s => s.speaker === silentSpeakerId);
      if (silentSegment) {
        participationFlags.push({
          transcriptId,
          flaggedWord: 'participation_silence',
          context: silentSegment.text.substring(0, 150),
          timestampMs: Math.floor(silentSegment.startTime * 1000),
          speaker: silentSpeakerId,
          flagType: 'participation',
        });
      }
    }
  }

  // Combine all flagged items
  const allFlaggedItems: InsertFlaggedContent[] = [
    ...profanity.flaggedItems,
    ...languagePolicy.violations,
    ...topicAdherence.offTopicSegments,
    ...participationFlags,
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

