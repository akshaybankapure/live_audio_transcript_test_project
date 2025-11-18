export function getSpeakerColor(speaker: string): string {
  const colors = ["blue", "green", "purple", "amber", "rose", "cyan"];
  const match = speaker.match(/(\d+)/);
  const speakerNumber = match ? parseInt(match[0]) : 1;
  return colors[(speakerNumber - 1) % colors.length];
}
