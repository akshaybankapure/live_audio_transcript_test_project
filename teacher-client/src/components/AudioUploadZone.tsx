import { Upload, FileAudio } from "lucide-react";
import { useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface AudioUploadZoneProps {
  onFileSelect: (file: File) => void;
  selectedFile?: File | null;
  onRemoveFile?: () => void;
}

export default function AudioUploadZone({
  onFileSelect,
  selectedFile,
  onRemoveFile,
}: AudioUploadZoneProps) {
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const files = e.dataTransfer.files;
      if (files.length > 0) {
        const file = files[0];
        if (file.type.startsWith("audio/")) {
          onFileSelect(file);
        }
      }
    },
    [onFileSelect]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        onFileSelect(files[0]);
      }
    },
    [onFileSelect]
  );

  if (selectedFile) {
    return (
      <Card className="p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10">
            <FileAudio className="h-4 w-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate" data-testid="text-filename">
              {selectedFile.name}
            </p>
            <p className="text-xs text-muted-foreground">
              {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
            </p>
          </div>
          {onRemoveFile && (
            <button
              onClick={onRemoveFile}
              className="text-muted-foreground hover:text-foreground"
              data-testid="button-remove-file"
            >
              ×
            </button>
          )}
        </div>
      </Card>
    );
  }

  return (
    <Card
      className="border-2 border-dashed hover-elevate cursor-pointer transition-colors"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      data-testid="card-upload-zone"
    >
      <label className="flex flex-col items-center justify-center p-8 cursor-pointer">
        <input
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={handleFileInput}
          data-testid="input-audio-file"
        />
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted mb-3">
          <Upload className="h-6 w-6 text-muted-foreground" />
        </div>
        <p className="text-sm font-medium mb-1">
          Drop your audio file here or click to browse
        </p>
        <p className="text-xs text-muted-foreground mb-3">
          Supports MP3, WAV, M4A files
        </p>
        <div className="flex gap-2">
          <Badge variant="secondary" className="text-xs">
            MP3
          </Badge>
          <Badge variant="secondary" className="text-xs">
            WAV
          </Badge>
          <Badge variant="secondary" className="text-xs">
            M4A
          </Badge>
        </div>
      </label>
    </Card>
  );
}
