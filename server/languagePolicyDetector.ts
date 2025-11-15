import type { InsertFlaggedContent, TranscriptSegment } from "@shared/schema";

// Allowed language for classroom discussions (configurable)
const ALLOWED_LANGUAGE = process.env.ALLOWED_LANGUAGE || 'en'; // Default: English only

export interface LanguagePolicyDetection {
  hasViolations: boolean;
  violations: InsertFlaggedContent[];
}

/**
 * Detects when speakers use non-allowed languages
 * For MVP: Simple check if segment language doesn't match allowed language
 */
export function detectLanguagePolicyViolations(
  segments: TranscriptSegment[],
  transcriptId: string,
  allowedLanguage: string = ALLOWED_LANGUAGE
): LanguagePolicyDetection {
  const violations: InsertFlaggedContent[] = [];

  for (const segment of segments) {
    // Check if segment has language info and it doesn't match allowed language
    if (segment.language && segment.language.toLowerCase() !== allowedLanguage.toLowerCase()) {
      const startTimeMs = segment.startTime * 1000;
      
      violations.push({
        transcriptId,
        flaggedWord: segment.language, // Store detected language as "flagged word"
        context: segment.text.substring(0, 100), // First 100 chars for context
        timestampMs: Math.floor(startTimeMs),
        speaker: segment.speaker,
        flagType: 'language_policy',
      });
    }
  }

  return {
    hasViolations: violations.length > 0,
    violations,
  };
}

