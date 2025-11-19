import type { TranscriptSegment } from "@shared/schema";

export interface SpeakerParticipation {
  speakerId: string;
  talkTime: number; // Total seconds of speaking time
  segmentCount: number;
  percentage: number; // Percentage of total talk time
}

export interface ParticipationBalance {
  speakers: SpeakerParticipation[];
  isBalanced: boolean;
  dominantSpeaker?: string; // Speaker with >50% of talk time
  silentSpeakers: string[]; // Speakers with <5% of talk time
  imbalanceReason?: string;
}

export interface ParticipationConfig {
  dominanceThreshold?: number; // Default: 0.5 (50%)
  silenceThreshold?: number;   // Default: 0.05 (5%)
}

/**
 * Analyzes participation balance across speakers
 * Flags if:
 * - One speaker dominates (>threshold% of talk time)
 * - Some speakers are silent (<threshold% of talk time)
 */
export function analyzeParticipationBalance(
  segments: TranscriptSegment[],
  config?: ParticipationConfig
): ParticipationBalance {
  if (segments.length === 0) {
    return {
      speakers: [],
      isBalanced: true,
      silentSpeakers: [],
    };
  }

  // Calculate talk time per speaker
  const speakerStats = new Map<string, { talkTime: number; segmentCount: number }>();
  
  for (const segment of segments) {
    const speakerId = segment.speaker;
    const duration = segment.endTime - segment.startTime;
    
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

  // Calculate percentages and identify issues
  const speakers: SpeakerParticipation[] = [];
  let dominantSpeaker: string | undefined;
  const silentSpeakers: string[] = [];
  
  // Calculate dynamic thresholds based on number of speakers
  // For dominance: a speaker is dominant if they take more than 1.5x their fair share
  // For silence: a speaker is silent if they take less than 0.3x their fair share
  const numberOfSpeakers = speakerStats.size;
  const fairShare = numberOfSpeakers > 0 ? 1 / numberOfSpeakers : 1;
  
  // Use custom thresholds if provided, otherwise calculate dynamic thresholds
  const DOMINANCE_THRESHOLD = config?.dominanceThreshold ?? (fairShare * 1.5); // Default: 1.5x fair share
  const SILENCE_THRESHOLD = config?.silenceThreshold ?? (fairShare * 0.3); // Default: 0.3x fair share
  
  // Cap thresholds at reasonable limits
  const finalDominanceThreshold = Math.min(DOMINANCE_THRESHOLD, 0.6); // Never flag below 60% as dominant
  const finalSilenceThreshold = Math.max(SILENCE_THRESHOLD, 0.05); // Never flag above 5% as silent

  for (const [speakerId, stats] of speakerStats.entries()) {
    const percentage = totalTalkTime > 0 ? stats.talkTime / totalTalkTime : 0;
    
    speakers.push({
      speakerId,
      talkTime: stats.talkTime,
      segmentCount: stats.segmentCount,
      percentage,
    });

    // Flag as dominant if percentage exceeds threshold
    // Only flag if there are at least 2 speakers (can't dominate a solo conversation)
    if (numberOfSpeakers >= 2 && percentage > finalDominanceThreshold) {
      dominantSpeaker = speakerId;
    }

    // Flag as silent if percentage is below threshold and they have spoken
    // Only flag if there are at least 3 speakers (in 2-person conversations, one might naturally be quieter)
    if (numberOfSpeakers >= 3 && percentage < finalSilenceThreshold && stats.segmentCount > 0) {
      silentSpeakers.push(speakerId);
    }
  }

  // Sort by percentage descending
  speakers.sort((a, b) => b.percentage - a.percentage);

  const isBalanced = !dominantSpeaker && silentSpeakers.length === 0;
  let imbalanceReason: string | undefined;

  if (dominantSpeaker) {
    const dominant = speakers.find(s => s.speakerId === dominantSpeaker);
    imbalanceReason = `${dominantSpeaker} dominates with ${(dominant?.percentage || 0) * 100}% of talk time`;
  } else if (silentSpeakers.length > 0) {
    imbalanceReason = `${silentSpeakers.length} speaker(s) are silent or barely participating`;
  }

  return {
    speakers,
    isBalanced,
    dominantSpeaker,
    silentSpeakers,
    imbalanceReason,
  };
}

