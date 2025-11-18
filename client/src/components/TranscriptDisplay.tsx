import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription } from "@/components/ui/alert";
import TranscriptSegment from "./TranscriptSegment";
import type { TranscriptSegment as TranscriptSegmentType, FlaggedContent } from "@shared/schema";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";

interface TranscriptDisplayProps {
  segments: TranscriptSegmentType[];
  currentTime?: number;
  onSegmentClick?: (segment: TranscriptSegmentType) => void;
  languages?: string[];
  transcriptId?: string;
}

const speakerColorMap: Record<string, string> = {};
const colorOptions = ["blue", "green", "purple", "amber", "rose", "cyan"];

function getSpeakerColor(speaker: string): string {
  if (!speakerColorMap[speaker]) {
    const usedColors = Object.values(speakerColorMap);
    const availableColors = colorOptions.filter(
      (c) => !usedColors.includes(c)
    );
    speakerColorMap[speaker] =
      availableColors[0] || colorOptions[Object.keys(speakerColorMap).length % colorOptions.length];
  }
  return speakerColorMap[speaker];
}

export default function TranscriptDisplay({
  segments,
  currentTime = 0,
  onSegmentClick,
  languages = [],
  transcriptId,
}: TranscriptDisplayProps) {
  const activeSegmentRef = useRef<HTMLDivElement>(null);
  const [showFlagNotification, setShowFlagNotification] = useState(false);
  const previousFlagCountRef = useRef<number>(0);

  // Fetch flagged content if transcriptId is provided
  const { data: flaggedContent = [] } = useQuery<FlaggedContent[]>({
    queryKey: ["/api/transcripts", transcriptId, "flagged"],
    enabled: !!transcriptId,
    refetchInterval: transcriptId ? 2000 : false, // Poll every 2 seconds for live updates
  });

  // Create a map of timestampMs to flags for quick lookup
  const flagsByTimestamp = new Map<number, FlaggedContent[]>();
  if (flaggedContent) {
    flaggedContent.forEach((flag) => {
      const timeKey = Math.floor(flag.timestampMs / 1000); // Round to seconds
      if (!flagsByTimestamp.has(timeKey)) {
        flagsByTimestamp.set(timeKey, []);
      }
      flagsByTimestamp.get(timeKey)!.push(flag);
    });
  }

  // Show notification when new flags are detected
  useEffect(() => {
    if (flaggedContent && flaggedContent.length > previousFlagCountRef.current) {
      setShowFlagNotification(true);
      const timer = setTimeout(() => setShowFlagNotification(false), 5000);
      previousFlagCountRef.current = flaggedContent.length;
      return () => clearTimeout(timer);
    }
  }, [flaggedContent]);

  const activeSegmentIndex = segments.findIndex(
    (segment) =>
      currentTime >= segment.startTime && currentTime <= segment.endTime
  );

  useEffect(() => {
    if (activeSegmentRef.current) {
      activeSegmentRef.current.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }
  }, [activeSegmentIndex]);

  // Helper function to get flags for a segment
  const getFlagsForSegment = (segment: TranscriptSegmentType): FlaggedContent[] => {
    const segmentStartTime = Math.floor(segment.startTime);
    const segmentEndTime = Math.floor(segment.endTime);
    const flags: FlaggedContent[] = [];
    
    for (let time = segmentStartTime; time <= segmentEndTime; time++) {
      const timeFlags = flagsByTimestamp.get(time) || [];
      flags.push(...timeFlags);
    }
    
    return flags;
  };

  if (segments.length === 0) {
    return (
      <Card className="p-6">
        <div className="flex items-center justify-center h-96 text-muted-foreground">
          <p className="text-sm">Upload an audio file to see the transcript</p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col h-full min-h-0 overflow-hidden">
      <div className="p-4 border-b border-card-border flex items-center justify-between">
        <h2 className="text-lg font-semibold">Transcript</h2>
        <div className="flex items-center gap-2">
          {showFlagNotification && (
            <Alert className="py-1 px-2 border-destructive bg-destructive/10">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              <AlertDescription className="text-xs font-semibold text-destructive">
                Flagged!
              </AlertDescription>
            </Alert>
          )}
          {languages.length > 0 && (
            <div className="flex gap-1" data-testid="container-languages">
              {languages.map((lang) => (
                <Badge key={lang} variant="outline" className="text-xs">
                  {lang}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-6 space-y-3">
          {segments.map((segment, index) => {
            const segmentFlags = getFlagsForSegment(segment);
            return (
              <div
                key={index}
                ref={index === activeSegmentIndex ? activeSegmentRef : null}
              >
                <TranscriptSegment
                  segment={segment}
                  isActive={index === activeSegmentIndex}
                  onClick={() => onSegmentClick?.(segment)}
                  speakerColor={getSpeakerColor(segment.speaker)}
                  flags={segmentFlags}
                />
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </Card>
  );
}
