import AudioPlayer from "../AudioPlayer";

export default function AudioPlayerExample() {
  return (
    <div className="p-6 bg-background">
      <AudioPlayer
        audioUrl="data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA="
        onTimeUpdate={(time) => console.log("Current time:", time)}
        onDelete={() => console.log("Delete clicked")}
      />
    </div>
  );
}
