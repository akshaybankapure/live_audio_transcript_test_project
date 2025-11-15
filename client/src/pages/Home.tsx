import { useState, useEffect, Suspense, lazy } from "react";
import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import AudioUploadZone from "@/components/AudioUploadZone";
import AudioPlayer from "@/components/AudioPlayer";
import TranscriptDisplay from "@/components/TranscriptDisplay";
import LanguageSelector from "@/components/LanguageSelector";
// Lazy load LiveRecordingPanel since it imports heavy Soniox library
const LiveRecordingPanel = lazy(() => import("@/components/LiveRecordingPanel"));
import type { TranscriptSegment } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Upload, Mic } from "lucide-react";

export default function Home() {
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [transcriptionId, setTranscriptionId] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState("en");
  const { toast } = useToast();

  const handleFileSelect = async (file: File) => {
    setAudioFile(file);
    const url = URL.createObjectURL(file);
    setAudioUrl(url);
    setIsUploading(true);

    try {
      const formData = new FormData();
      formData.append("audio", file);
      formData.append("language", selectedLanguage);

      const response = await fetch("/api/upload-audio", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to upload audio");
      }

      const result = await response.json();
      setTranscriptionId(result.id);

      toast({
        title: "Audio uploaded",
        description: "Transcription is being processed...",
      });
    } catch (error) {
      console.error("Upload error:", error);
      toast({
        title: "Upload failed",
        description: error instanceof Error ? error.message : "Failed to upload audio file",
        variant: "destructive",
      });
      handleRemoveFile();
    } finally {
      setIsUploading(false);
    }
  };

  const handleRemoveFile = () => {
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }
    setAudioFile(null);
    setAudioUrl(null);
    setCurrentTime(0);
    setTranscriptionId(null);
  };

  const handleSegmentClick = (segment: TranscriptSegment) => {
    setCurrentTime(segment.startTime);
  };

  // Poll for transcription results
  const { data: transcriptionData, isLoading: isPolling } = useQuery<{
    id: string;
    status: string;
    segments: TranscriptSegment[];
    languages: string[];
    duration: number;
  }>({
    queryKey: ["/api/transcription", transcriptionId],
    enabled: !!transcriptionId,
    refetchInterval: (query) => {
      const data = query.state.data;
      // Stop polling once completed or errored
      if (data?.status === "completed" || data?.status === "error") {
        return false;
      }
      // Poll every 2 seconds while processing
      return 2000;
    },
  });

  useEffect(() => {
    if (transcriptionData?.status === "completed") {
      toast({
        title: "Transcription complete",
        description: "Your audio has been successfully transcribed",
      });
    } else if (transcriptionData?.status === "error") {
      toast({
        title: "Transcription failed",
        description: "An error occurred while processing your audio",
        variant: "destructive",
      });
    }
  }, [transcriptionData?.status, toast]);

  const segments: TranscriptSegment[] = transcriptionData?.segments || [];
  const languages: string[] = transcriptionData?.languages || [];
  const isProcessing = isUploading || (transcriptionId && transcriptionData?.status === "processing");

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <header>
          <h1 className="text-2xl font-semibold mb-2">Audio Transcript Viewer</h1>
          <p className="text-sm text-muted-foreground">
            Upload an audio file or record live audio for real-time transcription with speaker diarization
          </p>
        </header>

        <Tabs defaultValue="upload" className="w-full">
          <TabsList className="grid w-full max-w-md grid-cols-2" data-testid="tabs-mode">
            <TabsTrigger value="upload" data-testid="tab-upload" className="gap-2">
              <Upload className="h-4 w-4" />
              Upload File
            </TabsTrigger>
            <TabsTrigger value="live" data-testid="tab-live" className="gap-2">
              <Mic className="h-4 w-4" />
              Live Recording
            </TabsTrigger>
          </TabsList>

          <TabsContent value="upload" className="mt-6">
            <div className="grid lg:grid-cols-[350px,1fr] gap-6">
          <div className="space-y-6">
            <div>
              <h2 className="text-sm font-medium mb-3">Audio Input</h2>
              <AudioUploadZone
                onFileSelect={handleFileSelect}
                selectedFile={audioFile}
                onRemoveFile={handleRemoveFile}
              />
            </div>

            {!audioFile && (
              <LanguageSelector
                value={selectedLanguage}
                onChange={setSelectedLanguage}
              />
            )}

            {isProcessing && (
              <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span className="text-sm text-muted-foreground">
                  {isUploading ? "Uploading..." : "Processing transcription..."}
                </span>
              </div>
            )}

            {audioUrl && !isProcessing && (
              <div>
                <AudioPlayer
                  audioUrl={audioUrl}
                  onTimeUpdate={setCurrentTime}
                  onDelete={handleRemoveFile}
                />
              </div>
            )}
          </div>

          <div className="h-[calc(100vh-12rem)]">
            <TranscriptDisplay
              segments={segments}
              currentTime={currentTime}
              onSegmentClick={handleSegmentClick}
              languages={languages}
            />
          </div>
            </div>
          </TabsContent>

          <TabsContent value="live" className="mt-6">
            <div className="grid lg:grid-cols-[350px,1fr] gap-6">
              <div className="space-y-6">
                <div>
                  <h2 className="text-sm font-medium mb-3">Live Recording</h2>
                  <LanguageSelector
                    value={selectedLanguage}
                    onChange={setSelectedLanguage}
                  />
                </div>
              </div>

              <div className="h-[calc(100vh-12rem)]">
                <Suspense fallback={
                  <div className="flex items-center justify-center h-full">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  </div>
                }>
                  <LiveRecordingPanel selectedLanguage={selectedLanguage} />
                </Suspense>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
