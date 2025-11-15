import { Filter } from "bad-words";
import type { InsertFlaggedContent } from "@shared/schema";

const filter = new Filter();

// Add additional offensive words to catch
const additionalBadWords = [
  'crap', 'damn', 'hell', 'bastard', 'bitch', 'shit', 'fuck',
  'asshole', 'dick', 'pussy', 'cock', 'piss', 'whore', 'slut'
];

filter.addWords(...additionalBadWords);

export interface ProfanityDetection {
  hasProfanity: boolean;
  flaggedItems: InsertFlaggedContent[];
}

export function detectProfanity(
  segments: any[],
  transcriptId: string
): ProfanityDetection {
  const flaggedItems: InsertFlaggedContent[] = [];

  for (const segment of segments) {
    const words = segment.text.split(/\s+/);
    const startTimeMs = segment.startTime * 1000;
    const durationMs = (segment.endTime - segment.startTime) * 1000;
    const msPerWord = durationMs / words.length;

    words.forEach((word: string, index: number) => {
      const cleanWord = word.replace(/[^\w]/g, "").toLowerCase();
      
      if (filter.isProfane(cleanWord)) {
        // Calculate approximate timestamp for this word
        const wordTimestampMs = Math.floor(startTimeMs + (index * msPerWord));
        
        // Get context (surrounding words)
        const contextStart = Math.max(0, index - 3);
        const contextEnd = Math.min(words.length, index + 4);
        const context = words.slice(contextStart, contextEnd).join(" ");

        flaggedItems.push({
          transcriptId,
          flaggedWord: word,
          context,
          timestampMs: wordTimestampMs,
          speaker: segment.speaker,
          flagType: 'profanity',
        });
      }
    });
  }

  return {
    hasProfanity: flaggedItems.length > 0,
    flaggedItems,
  };
}
