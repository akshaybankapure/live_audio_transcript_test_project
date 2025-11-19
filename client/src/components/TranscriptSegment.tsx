import { Badge } from "@/components/ui/badge";
import type { TranscriptSegment as TranscriptSegmentType, FlaggedContent } from "@shared/schema";
import { highlightProfanity, hasProfanity, highlightLanguagePolicyViolations } from "@/lib/profanityDetector";
import { getFlagConfig, getFlagBadgeClassName, type FlagType } from "@/lib/flagConfig";

interface TranscriptSegmentProps {
  segment: TranscriptSegmentType;
  isActive?: boolean;
  onClick?: () => void;
  speakerColor: string;
  flags?: FlaggedContent[]; // Flags associated with this segment
}

const speakerColors = {
  blue: {
    border: "border-l-blue-500",
    badge: "bg-blue-100 text-blue-700 border-blue-200",
    badgeDark: "dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800",
  },
  green: {
    border: "border-l-green-500",
    badge: "bg-green-100 text-green-700 border-green-200",
    badgeDark: "dark:bg-green-950 dark:text-green-300 dark:border-green-800",
  },
  purple: {
    border: "border-l-purple-500",
    badge: "bg-purple-100 text-purple-700 border-purple-200",
    badgeDark: "dark:bg-purple-950 dark:text-purple-300 dark:border-purple-800",
  },
  amber: {
    border: "border-l-amber-500",
    badge: "bg-amber-100 text-amber-700 border-amber-200",
    badgeDark: "dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800",
  },
  rose: {
    border: "border-l-rose-500",
    badge: "bg-rose-100 text-rose-700 border-rose-200",
    badgeDark: "dark:bg-rose-950 dark:text-rose-300 dark:border-rose-800",
  },
  cyan: {
    border: "border-l-cyan-500",
    badge: "bg-cyan-100 text-cyan-700 border-cyan-200",
    badgeDark: "dark:bg-cyan-950 dark:text-cyan-300 dark:border-cyan-800",
  },
};

export default function TranscriptSegment({
  segment,
  isActive,
  onClick,
  speakerColor,
  flags = [],
}: TranscriptSegmentProps) {
  const colorScheme =
    speakerColors[speakerColor as keyof typeof speakerColors] ||
    speakerColors.blue;

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  // Match flags to this segment by timestamp and speaker
  const segmentStartMs = segment.startTime * 1000;
  const segmentEndMs = segment.endTime * 1000;
  const segmentFlags = flags.filter(flag => {
    const flagTime = flag.timestampMs;
    const speakerMatch = !flag.speaker || flag.speaker === segment.speaker;
    const timeMatch = flagTime >= segmentStartMs && flagTime <= segmentEndMs;
    return speakerMatch && timeMatch;
  });

  // Group flags by type
  const flagsByType = {
    profanity: segmentFlags.filter(f => f.flagType === 'profanity'),
    language_policy: segmentFlags.filter(f => f.flagType === 'language_policy'),
    participation: segmentFlags.filter(f => f.flagType === 'participation'),
    off_topic: segmentFlags.filter(f => f.flagType === 'off_topic'),
  };

  // Check for inline detection (profanity in text, language mismatch)
  const hasProfanityInline = hasProfanity(segment.text);
  const hasLanguageViolation = segment.language && segment.language.toLowerCase() !== 'en';

  return (
    <div
      className={`border-l-4 ${colorScheme.border} pl-4 py-3 space-y-2 cursor-pointer hover-elevate transition-all ${
        isActive ? "bg-muted/50" : ""
      }`}
      onClick={onClick}
      data-testid={`segment-${segment.speaker.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <Badge
          variant="secondary"
          className={`uppercase text-xs font-semibold ${colorScheme.badge} ${colorScheme.badgeDark} border`}
          data-testid="badge-speaker"
        >
          {segment.speaker}
        </Badge>
        <span className="text-xs text-muted-foreground font-mono" data-testid="text-timestamp">
          {formatTime(segment.startTime)}
        </span>
        {segment.language && (
          <Badge variant="outline" className="text-xs">
            {segment.language}
          </Badge>
        )}
        {/* Show flag badges for all 4 types */}
        {(hasProfanityInline || flagsByType.profanity.length > 0) && (() => {
          const config = getFlagConfig('profanity');
          const Icon = config.icon;
          return (
            <Badge variant={config.variant} className={getFlagBadgeClassName('profanity')}>
              <Icon className="h-3 w-3 mr-1" />
              Profanity
            </Badge>
          );
        })()}
        {(hasLanguageViolation || flagsByType.language_policy.length > 0) && (() => {
          const config = getFlagConfig('language_policy');
          const Icon = config.icon;
          return (
            <Badge variant={config.variant} className={getFlagBadgeClassName('language_policy')}>
              <Icon className="h-3 w-3 mr-1" />
              Language Policy
            </Badge>
          );
        })()}
        {flagsByType.participation.length > 0 && (() => {
          const config = getFlagConfig('participation');
          const Icon = config.icon;
          return (
            <Badge variant={config.variant} className={getFlagBadgeClassName('participation')}>
              <Icon className="h-3 w-3 mr-1" />
              Participation
            </Badge>
          );
        })()}
        {flagsByType.off_topic.length > 0 && (() => {
          const config = getFlagConfig('off_topic');
          const Icon = config.icon;
          return (
            <Badge variant={config.variant} className={getFlagBadgeClassName('off_topic')}>
              <Icon className="h-3 w-3 mr-1" />
              Off-Topic
            </Badge>
          );
        })()}
      </div>
      <p className="text-base leading-relaxed whitespace-pre-wrap break-words" data-testid="text-transcript">
        {(() => {
          // First highlight profanity
          const profanityParts = highlightProfanity(segment.text);
          // Then highlight language policy violations within each part
          const allowedLanguage = 'en'; // Default allowed language (can be made configurable)
          const allParts: Array<{ text: string; isProfanity: boolean; isLanguageViolation: boolean }> = [];
          
          for (const profanityPart of profanityParts) {
            if (profanityPart.isProfanity) {
              // If it's profanity, keep it as profanity (profanity takes priority)
              allParts.push({
                text: profanityPart.text,
                isProfanity: true,
                isLanguageViolation: false,
              });
            } else {
              // Check for language violations in non-profanity text
              const langParts = highlightLanguagePolicyViolations(
                profanityPart.text,
                segment.language,
                allowedLanguage
              );
              for (const langPart of langParts) {
                allParts.push({
                  text: langPart.text,
                  isProfanity: false,
                  isLanguageViolation: langPart.isLanguageViolation,
                });
              }
            }
          }
          
          return allParts.map((part, idx) => {
            if (part.isProfanity) {
              return (
                <mark
                  key={idx}
                  className="bg-red-200 dark:bg-red-900/50 text-red-900 dark:text-red-200 px-0.5 rounded font-semibold"
                  title="Profanity detected"
                >
                  {part.text}
                </mark>
              );
            } else if (part.isLanguageViolation) {
              return (
                <mark
                  key={idx}
                  className="bg-orange-200 dark:bg-orange-900/50 text-orange-900 dark:text-orange-200 px-0.5 rounded font-semibold"
                  title="Non-allowed language detected"
                >
                  {part.text}
                </mark>
              );
            } else {
              return <span key={idx}>{part.text}</span>;
            }
          });
        })()}
      </p>
    </div>
  );
}
