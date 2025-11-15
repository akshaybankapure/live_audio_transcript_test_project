import TranscriptDisplay from "../TranscriptDisplay";
import type { TranscriptSegment } from "@shared/schema";
import { useState } from "react";

export default function TranscriptDisplayExample() {
  const [currentTime, setCurrentTime] = useState(5);

  const segments: TranscriptSegment[] = [
    {
      speaker: "SPEAKER 1",
      text: "[Hindi] हां हाँ एक्सीलेंस<end>",
      startTime: 0,
      endTime: 2.5,
      language: "Hindi",
    },
    {
      speaker: "SPEAKER 2",
      text: "हेलो<end>",
      startTime: 2.5,
      endTime: 3.2,
      language: "Hindi",
    },
    {
      speaker: "SPEAKER 1",
      text: "हाय आर यू<end>",
      startTime: 3.2,
      endTime: 4.5,
      language: "Hindi",
    },
    {
      speaker: "SPEAKER 2",
      text: "गुड इवनिंग<end>",
      startTime: 4.5,
      endTime: 5.8,
      language: "Hindi",
    },
    {
      speaker: "SPEAKER 1",
      text: "[Persian] سلام [English] Today we are playing a debate game and today I am supporting the AI and my opponent supporting the AI is not good. So start with.<end>",
      startTime: 5.8,
      endTime: 15.2,
      language: "Persian/English",
    },
    {
      speaker: "SPEAKER 2",
      text: "Okay, so as what I am thinking that AI is really not good for everyone. The each and every individual who is existing in the earth, why? Because there are so many things we are affecting only because of AI. Nowadays you are living in that century where everyone and each and every person is totally dependent on the AI.<end>",
      startTime: 15.2,
      endTime: 35.5,
      language: "English",
    },
  ];

  return (
    <div className="p-6 bg-background h-[600px]">
      <TranscriptDisplay
        segments={segments}
        currentTime={currentTime}
        onSegmentClick={(segment) => {
          console.log("Clicked segment:", segment);
          setCurrentTime(segment.startTime);
        }}
        languages={["Hindi", "Persian", "English"]}
      />
    </div>
  );
}
