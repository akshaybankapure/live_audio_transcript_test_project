import AudioUploadZone from "../AudioUploadZone";
import { useState } from "react";

export default function AudioUploadZoneExample() {
  const [file, setFile] = useState<File | null>(null);

  return (
    <div className="p-6 bg-background">
      <AudioUploadZone
        onFileSelect={(f) => {
          console.log("File selected:", f.name);
          setFile(f);
        }}
        selectedFile={file}
        onRemoveFile={() => {
          console.log("File removed");
          setFile(null);
        }}
      />
    </div>
  );
}
