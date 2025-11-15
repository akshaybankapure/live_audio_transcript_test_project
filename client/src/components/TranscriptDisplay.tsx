import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import TranscriptSegment from "./TranscriptSegment";
import type { TranscriptSegment as TranscriptSegmentType } from "@shared/schema";
import { useEffect, useRef } from "react";

interface TranscriptDisplayProps {
  segments: TranscriptSegmentType[];
  currentTime?: number;
  onSegmentClick?: (segment: TranscriptSegmentType) => void;
  languages?: string[];
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
}: TranscriptDisplayProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeSegmentRef = useRef<HTMLDivElement>(null);

  const activeSegmentIndex = segments.findIndex(
    (segment) =>
      currentTime >= segment.startTime && currentTime <= segment.endTime
  );

  useEffect(() => {
    if (activeSegmentRef.current && scrollRef.current) {
      activeSegmentRef.current.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }
  }, [activeSegmentIndex]);

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
    <Card className="flex flex-col h-full">
      <div className="p-4 border-b border-card-border flex items-center justify-between">
        <h2 className="text-lg font-semibold">Transcript</h2>
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
      <ScrollArea className="flex-1" ref={scrollRef}>
        <div className="p-6 space-y-3">
          {segments.map((segment, index) => (
            <div
              key={index}
              ref={index === activeSegmentIndex ? activeSegmentRef : null}
            >
              <TranscriptSegment
                segment={segment}
                isActive={index === activeSegmentIndex}
                onClick={() => onSegmentClick?.(segment)}
                speakerColor={getSpeakerColor(segment.speaker)}
              />
            </div>
          ))}
        </div>
      </ScrollArea>
    </Card>
  );
}
