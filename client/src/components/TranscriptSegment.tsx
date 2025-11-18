import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { TranscriptSegment as TranscriptSegmentType, FlaggedContent } from "@shared/schema";
import { AlertTriangle, Flag } from "lucide-react";

interface TranscriptSegmentProps {
  segment: TranscriptSegmentType;
  isActive?: boolean;
  onClick?: () => void;
  speakerColor: string;
  flags?: FlaggedContent[];
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

  const getFlagTypeColor = (flagType: string) => {
    switch (flagType) {
      case 'profanity':
        return 'text-destructive border-destructive bg-destructive/10';
      case 'language_policy':
        return 'text-orange-600 border-orange-500 bg-orange-50';
      case 'off_topic':
        return 'text-yellow-600 border-yellow-500 bg-yellow-50';
      case 'participation':
        return 'text-blue-600 border-blue-500 bg-blue-50';
      default:
        return 'text-muted-foreground border-muted bg-muted/10';
    }
  };

  const getFlagTypeLabel = (flagType: string) => {
    switch (flagType) {
      case 'profanity':
        return 'Profanity';
      case 'language_policy':
        return 'Language Policy';
      case 'off_topic':
        return 'Off-Topic';
      case 'participation':
        return 'Participation';
      default:
        return 'Flagged';
    }
  };

  const hasFlags = flags.length > 0;

  return (
    <div
      className={`border-l-4 ${colorScheme.border} pl-4 py-3 space-y-2 cursor-pointer hover-elevate transition-all ${
        isActive ? "bg-muted/50" : ""
      } ${hasFlags ? "bg-destructive/5 border-destructive/30" : ""}`}
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
        {hasFlags && (
          <Popover>
            <PopoverTrigger asChild>
              <Badge
                variant="outline"
                className={`text-xs border-destructive text-destructive bg-destructive/10 cursor-pointer hover:bg-destructive/20 flex items-center gap-1`}
              >
                <Flag className="h-3 w-3" />
                Flagged!
              </Badge>
            </PopoverTrigger>
            <PopoverContent className="w-80" align="start">
              <div className="space-y-3">
                <div className="font-semibold text-sm flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                  Content Flagged
                </div>
                {flags.map((flag, index) => (
                  <Alert
                    key={index}
                    className={`${getFlagTypeColor(flag.flagType)} border`}
                  >
                    <AlertDescription className="text-xs space-y-1">
                      <div className="font-semibold">
                        {getFlagTypeLabel(flag.flagType)} Violation
                      </div>
                      <div className="text-xs opacity-90">
                        {flag.context || `Flagged word: "${flag.flaggedWord}"`}
                      </div>
                      {flag.speaker && (
                        <div className="text-xs opacity-75 mt-1">
                          Speaker: {flag.speaker}
                        </div>
                      )}
                    </AlertDescription>
                  </Alert>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        )}
      </div>
      <p className="text-base leading-relaxed" data-testid="text-transcript">
        {segment.text}
      </p>
    </div>
  );
}
