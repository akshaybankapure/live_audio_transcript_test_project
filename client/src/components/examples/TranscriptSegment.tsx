import TranscriptSegment from "../TranscriptSegment";
import type { TranscriptSegment as TranscriptSegmentType } from "@shared/schema";

export default function TranscriptSegmentExample() {
  const segment1: TranscriptSegmentType = {
    speaker: "SPEAKER 1",
    text: "[Hindi] हां हाँ एक्सीलेंस<end>",
    startTime: 0,
    endTime: 2.5,
    language: "Hindi",
  };

  const segment2: TranscriptSegmentType = {
    speaker: "SPEAKER 2",
    text: "Okay, so as what I am thinking that AI is really not good for everyone. The each and every individual who is existing in the earth, why? Because there are so many things we are affecting only because of AI. Nowadays you are living in that century where everyone and each and every person is totally dependent on the AI.<end>",
    startTime: 2.5,
    endTime: 15.8,
    language: "English",
  };

  return (
    <div className="p-6 bg-background space-y-3">
      <TranscriptSegment
        segment={segment1}
        speakerColor="blue"
        onClick={() => console.log("Clicked segment 1")}
      />
      <TranscriptSegment
        segment={segment2}
        speakerColor="green"
        isActive={true}
        onClick={() => console.log("Clicked segment 2")}
      />
    </div>
  );
}
