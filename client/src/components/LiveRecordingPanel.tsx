import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Mic, MicOff, Loader2, Settings } from "lucide-react";
import { SonioxClient } from "@soniox/speech-to-text-web";
import type { TranscriptSegment as TranscriptSegmentType } from "@shared/schema";
import TranscriptSegment from "./TranscriptSegment";
import { useToast } from "@/hooks/use-toast";
import { getSpeakerColor } from "@/lib/transcripts";

interface LiveRecordingPanelProps {
  selectedLanguage: string;
}

interface Token {
  text: string;
  start_ms?: number;
  end_ms?: number;
  is_final: boolean;
  speaker?: string;
  language?: string;
  confidence?: number;
}

export default function LiveRecordingPanel({ selectedLanguage }: LiveRecordingPanelProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [segments, setSegments] = useState<TranscriptSegmentType[]>([]);
  const [currentNonFinalTokens, setCurrentNonFinalTokens] = useState<Token[]>([]);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [profanityCount, setProfanityCount] = useState(0);
  const [showConfigDialog, setShowConfigDialog] = useState(false);
  const [topicPrompt, setTopicPrompt] = useState("");
  const [topicKeywords, setTopicKeywords] = useState("");
  const [dominanceThreshold, setDominanceThreshold] = useState(50);
  const [silenceThreshold, setSilenceThreshold] = useState(5);
  const sonioxClientRef = useRef<SonioxClient | null>(null);
  const tokenMapRef = useRef<Map<string, Token>>(new Map());
  const segmentsRef = useRef<TranscriptSegmentType[]>([]); // Store current segments for callbacks
  const cleanupTimeoutRef = useRef<NodeJS.Timeout | null>(null); // Store cleanup timeout ID
  const transcriptIdRef = useRef<string | null>(null); // Store draft transcript ID
  const lastSentIdxRef = useRef<number>(0); // Track which segments have been sent
  const savePromiseRef = useRef<Promise<void> | null>(null); // Track in-flight save operations
  const lastAppendTimeRef = useRef<number>(0); // Track last append time for batching
  const pendingStartRef = useRef<(() => void) | null>(null); // Store pending start function
  const { toast} = useToast();
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // Cleanup on unmount
    return () => {
      if (sonioxClientRef.current) {
        sonioxClientRef.current.cancel();
      }
      if (cleanupTimeoutRef.current) {
        clearTimeout(cleanupTimeoutRef.current);
      }
    };
  }, []);

  // Auto-scroll to bottom as live transcript grows
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [segments, currentNonFinalTokens]);

  const getLanguageHints = () => {
    if (selectedLanguage === "auto") {
      return ["en", "es", "fr", "de", "pt", "hi", "zh", "ja", "ko"];
    }
    return [selectedLanguage];
  };

  const processTokensIntoSegments = (tokens: Token[]) => {
    const newSegments: TranscriptSegmentType[] = [];
    let currentSegment: TranscriptSegmentType | null = null;
    let currentSpeaker = "";
    let currentText = "";

    for (const token of tokens) {
      if (!token.is_final) continue; // Only process final tokens for segments

      const speaker = token.speaker || "1";
      const speakerLabel = speaker.startsWith("SPEAKER") ? speaker : `SPEAKER ${speaker}`;

      if (currentSpeaker !== speakerLabel) {
        // Save previous segment
        if (currentSegment) {
          newSegments.push(currentSegment);
        }

        // Start new segment
        currentSpeaker = speakerLabel;
        currentText = token.text;
        currentSegment = {
          speaker: speakerLabel,
          text: token.text,
          startTime: (token.start_ms || 0) / 1000,
          endTime: (token.end_ms || 0) / 1000,
          language: token.language || "en",
        };
      } else {
        // Continue current segment
        currentText += token.text;
        if (currentSegment) {
          currentSegment.text = currentText;
          currentSegment.endTime = (token.end_ms || 0) / 1000;
        }
      }
    }

    // Add final segment
    if (currentSegment) {
      newSegments.push(currentSegment);
    }

    return newSegments;
  };

  const createDraftTranscript = async (): Promise<string | null> => {
    try {
      const topicKeywordsArray = topicKeywords
        ? topicKeywords.split(',').map(k => k.trim()).filter(k => k.length > 0)
        : undefined;

      const participationConfig = {
        dominanceThreshold: dominanceThreshold / 100, // Convert percentage to decimal
        silenceThreshold: silenceThreshold / 100,
      };

      const response = await fetch("/api/transcripts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: `Live Recording ${new Date().toLocaleString()}`,
          language: selectedLanguage,
          topicPrompt: topicPrompt || undefined,
          topicKeywords: topicKeywordsArray,
          participationConfig: participationConfig,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to create draft transcript");
      }

      const transcript = await response.json();
      return transcript.id;
    } catch (error) {
      console.error("Failed to create draft transcript:", error);
      return null;
    }
  };

  const appendSegments = async (): Promise<void> => {
    const transcriptId = transcriptIdRef.current;
    if (!transcriptId) return;

    // Explicit retry loop with fresh state reads
    const MAX_RETRIES = 3;
    const BASE_DELAY = 100;
    
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        setSaveStatus('saving');
        
        // Always read FRESH index and segments at top of each attempt
        const fromIndex = lastSentIdxRef.current;
        const freshSegments = segmentsRef.current;
        const unsentSegments = freshSegments.slice(fromIndex);
        
        // Skip if no unsent segments
        if (unsentSegments.length === 0) {
          setSaveStatus('saved');
          return;
        }
        
        const response = await fetch(`/api/transcripts/${transcriptId}/segments`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            segments: unsentSegments,
            fromIndex,
          }),
        });

        if (!response.ok) {
          if (response.status === 409 && attempt < MAX_RETRIES) {
            // Index mismatch - parse index and retry
            const errorData = await response.json();
            console.warn(`Index mismatch (attempt ${attempt + 1}/${MAX_RETRIES + 1}):`, errorData.error);
            
            // Parse index from error: "Index mismatch: expected X, got Y"
            const match = errorData.error?.match(/got (\d+)/);
            if (match) {
              lastSentIdxRef.current = parseInt(match[1], 10);
              
              // Exponential backoff
              const delay = BASE_DELAY * Math.pow(2, attempt);
              await new Promise(resolve => setTimeout(resolve, delay));
              continue; // Loop will refresh segments at top
            }
          }
          
          // Non-409 error or max retries exceeded
          throw new Error(`Failed to append segments: ${response.status}`);
        }

        // Success
        const result = await response.json();
        lastSentIdxRef.current = result.lastSegmentIdx || (fromIndex + unsentSegments.length);
        
        if (result.newFlaggedItems && result.newFlaggedItems.length > 0) {
          setProfanityCount(prev => prev + result.newFlaggedItems.length);
        }
        
        setSaveStatus('saved');
        lastAppendTimeRef.current = Date.now();
        return;
        
      } catch (error) {
        console.error(`Append failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}):`, error);
        
        if (attempt === MAX_RETRIES) {
          setSaveStatus('error');
          return;
        }
        
        // Retry on network errors with backoff (loop will refresh segments)
        const delay = BASE_DELAY * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  };

  const completeTranscript = async (): Promise<void> => {
    const transcriptId = transcriptIdRef.current;
    if (!transcriptId) return;

    try {
      const currentSegments = segmentsRef.current;
      const duration = currentSegments[currentSegments.length - 1]?.endTime || 0;

      const response = await fetch(`/api/transcripts/${transcriptId}/complete`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          duration,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to complete transcript");
      }

      toast({
        title: "Recording saved",
        description: profanityCount > 0 
          ? `Saved with ${profanityCount} flagged item(s)`
          : "Transcript saved successfully",
      });
    } catch (error) {
      console.error("Failed to complete transcript:", error);
      toast({
        title: "Failed to complete",
        description: "Transcript may be incomplete",
        variant: "destructive",
      });
    }
  };

  const tryAppendBatch = async () => {
    // Don't append if already saving or no draft created yet
    if (savePromiseRef.current || !transcriptIdRef.current) return;

    const currentSegments = segmentsRef.current;
    const unsentSegments = currentSegments.slice(lastSentIdxRef.current);

    // Batching threshold: 5 segments or 3 seconds since last append
    const segmentThreshold = 5;
    const timeThreshold = 3000; // 3 seconds
    const timeSinceLastAppend = Date.now() - lastAppendTimeRef.current;

    const shouldAppend = 
      unsentSegments.length >= segmentThreshold || 
      (unsentSegments.length > 0 && timeSinceLastAppend >= timeThreshold);

    if (shouldAppend) {
      // Serialize save operations
      const savePromise = appendSegments(); // No params - reads fresh state inside
      savePromiseRef.current = savePromise;
      await savePromise;
      savePromiseRef.current = null; // Always clear promise
    }
  };

  const handleStartRecording = () => {
    // Show config dialog first
    setShowConfigDialog(true);
  };

  const startRecording = async () => {
    try {
      setIsInitializing(true);
      setShowConfigDialog(false); // Close dialog
      
      let apiKey = import.meta.env.VITE_SONIOX_API_KEY;
      
      // Try to fetch temporary API key from backend if not in env
      if (!apiKey) {
        try {
          const response = await fetch("/api/get-temp-api-key", {
            method: "POST",
          });
          if (response.ok) {
            const data = await response.json();
            apiKey = data.apiKey;
          } else {
            console.error("Failed to get temporary API key:", response.status, response.statusText);
          }
        } catch (err) {
          console.error("Failed to fetch temporary API key:", err);
        }
      }

      if (!apiKey) {
        throw new Error("No Soniox API key available. Please set VITE_SONIOX_API_KEY environment variable or implement /api/get-temp-api-key endpoint.");
      }

      const client = new SonioxClient({
        apiKey,
        bufferQueueSize: 1000,
      });

      sonioxClientRef.current = client;

      // Clear any pending cleanup timeout from previous session
      if (cleanupTimeoutRef.current) {
        clearTimeout(cleanupTimeoutRef.current);
        cleanupTimeoutRef.current = null;
      }

      // Reset token map and UI state for new recording session
      tokenMapRef.current.clear();
      setSegments([]);
      segmentsRef.current = []; // Keep ref in sync
      setCurrentNonFinalTokens([]);
      setProfanityCount(0);
      setSaveStatus('idle');
      lastSentIdxRef.current = 0;
      lastAppendTimeRef.current = Date.now();

      await client.start({
        model: "stt-rt-preview",
        languageHints: getLanguageHints(),
        enableSpeakerDiarization: true,
        enableLanguageIdentification: selectedLanguage === "auto",
        enableEndpointDetection: true,

        onPartialResult: (result: any) => {
          console.log("Partial result:", result);
          
          // Update tokens - deduplicate by start_ms+end_ms, final tokens replace partials
          if (result.tokens && result.tokens.length > 0) {
            result.tokens.forEach((token: Token) => {
              const startMs = token.start_ms ?? 0;
              const endMs = token.end_ms ?? 0;
              const key = `${startMs}_${endMs}`;
              const existing = tokenMapRef.current.get(key);
              
              // Replace if: no existing token, or new token is final, or existing is not final
              if (!existing || token.is_final || !existing.is_final) {
                tokenMapRef.current.set(key, token);
              }
            });
            
            // Extract non-final tokens from current result for preview
            const nonFinalTokens = result.tokens.filter((t: Token) => !t.is_final);
            setCurrentNonFinalTokens(nonFinalTokens);

            // Process all accumulated final tokens into segments
            const finalTokens = Array.from(tokenMapRef.current.values())
              .filter(t => t.is_final)
              .sort((a, b) => (a.start_ms || 0) - (b.start_ms || 0));
            const newSegments = processTokensIntoSegments(finalTokens);
            segmentsRef.current = newSegments; // Keep ref in sync
            setSegments(newSegments);

            // Progressive save: Try to append batch if threshold met
            tryAppendBatch();
          }
        },

        onStarted: async () => {
          console.log("Recording started");
          setIsRecording(true);
          setIsInitializing(false);

          // Create draft transcript for progressive saving
          const draftId = await createDraftTranscript();
          if (draftId) {
            transcriptIdRef.current = draftId;
            console.log("Draft transcript created:", draftId);
          } else {
            toast({
              title: "Warning",
              description: "Failed to create draft transcript. Recording will not be auto-saved.",
              variant: "destructive",
            });
          }
        },

        onFinished: async () => {
          console.log("Recording finished");
          setIsRecording(false);
          setCurrentNonFinalTokens([]);
          
          // Progressive save: Send any remaining unsent segments and mark complete
          if (transcriptIdRef.current && segmentsRef.current.length > 0) {
            // Wait for any in-flight save to complete
            if (savePromiseRef.current) {
              await savePromiseRef.current;
            }

            // Send remaining segments
            if (segmentsRef.current.length > lastSentIdxRef.current) {
              await appendSegments();
            }

            // Mark transcript as complete
            await completeTranscript();

            // Clear local state after delay
            cleanupTimeoutRef.current = setTimeout(() => {
              setSegments([]);
              segmentsRef.current = [];
              tokenMapRef.current.clear();
              transcriptIdRef.current = null;
              lastSentIdxRef.current = 0;
              setProfanityCount(0);
              setSaveStatus('idle');
              cleanupTimeoutRef.current = null;
            }, 2000);
          }
        },

        onError: (error: any) => {
          console.error("Recording error:", error);
          setIsRecording(false);
          setIsInitializing(false);
          toast({
            title: "Recording error",
            description: error.message || "Failed to record audio",
            variant: "destructive",
          });
        },
      });
    } catch (error) {
      console.error("Failed to start recording:", error);
      setIsInitializing(false);
      setIsRecording(false);
      toast({
        title: "Failed to start recording",
        description: error instanceof Error ? error.message : "Please check your API key configuration",
        variant: "destructive",
      });
    }
  };

  const stopRecording = async () => {
    if (sonioxClientRef.current) {
      await sonioxClientRef.current.stop();
      setCurrentNonFinalTokens([]);
      // Don't save here - wait for onFinished to ensure all final tokens are included
    }
  };

  const saveTranscript = async (): Promise<boolean> => {
    // Read from ref to get current segments (avoid stale closure)
    const currentSegments = segmentsRef.current;
    
    if (currentSegments.length === 0) {
      toast({
        title: "No transcript to save",
        description: "Record some audio first",
        variant: "destructive",
      });
      return false;
    }

    try {
      const response = await fetch("/api/save-live-transcript", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: `Live Recording ${new Date().toLocaleString()}`,
          segments: currentSegments,
          language: selectedLanguage,
          duration: currentSegments[currentSegments.length - 1]?.endTime || 0,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to save transcript");
      }

      const result = await response.json();
      console.log("Transcript saved:", result);

      toast({
        title: "Recording saved",
        description: result.flaggedContent?.length 
          ? `Saved with ${result.flaggedContent.length} flagged item(s)`
          : "Transcript saved successfully",
      });
      
      return true; // Save succeeded
    } catch (error) {
      console.error("Failed to save transcript:", error);
      toast({
        title: "Failed to save",
        description: error instanceof Error ? error.message : "Could not save transcript",
        variant: "destructive",
      });
      return false; // Save failed
    }
  };

  const clearTranscript = () => {
    setSegments([]);
    segmentsRef.current = []; // Clear ref too
    setCurrentNonFinalTokens([]);
    tokenMapRef.current.clear();
  };

  const renderNonFinalTokens = () => {
    if (currentNonFinalTokens.length === 0) return null;
    
    const text = currentNonFinalTokens.map(t => t.text).join("");
    return (
      <Card className="p-4 bg-muted/50 border-dashed">
        <p className="text-sm text-muted-foreground italic">{text}</p>
      </Card>
    );
  };

  return (
    <div className="h-full flex flex-col gap-4 min-h-0">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          {!isRecording && !isInitializing ? (
            <Button
              onClick={handleStartRecording}
              size="default"
              data-testid="button-start-recording"
              className="gap-2"
            >
              <Mic className="h-4 w-4" />
              Start Recording
            </Button>
          ) : (
            <Button
              onClick={stopRecording}
              variant="destructive"
              size="default"
              data-testid="button-stop-recording"
              disabled={isInitializing}
              className="gap-2"
            >
              {isInitializing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Initializing...
                </>
              ) : (
                <>
                  <MicOff className="h-4 w-4" />
                  Stop Recording
                </>
              )}
            </Button>
          )}
        </div>

        {segments.length > 0 && !isRecording && (
          <Button
            onClick={clearTranscript}
            variant="outline"
            size="sm"
            data-testid="button-clear-transcript"
          >
            Clear Transcript
          </Button>
        )}
      </div>

      {isRecording && (
        <Card className="p-3 bg-destructive/10 border-destructive/50">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-destructive animate-pulse" />
              <p className="text-sm font-medium">Recording in progress...</p>
            </div>
            <div className="flex items-center gap-3">
              {saveStatus === 'saving' && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="status-saving">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span>Saving...</span>
                </div>
              )}
              {saveStatus === 'saved' && (
                <div className="flex items-center gap-2 text-xs text-green-600 dark:text-green-400" data-testid="status-saved">
                  <div className="h-2 w-2 rounded-full bg-green-600 dark:bg-green-400" />
                  <span>Saved</span>
                </div>
              )}
              {saveStatus === 'error' && (
                <div className="flex items-center gap-2 text-xs text-destructive" data-testid="status-error">
                  <div className="h-2 w-2 rounded-full bg-destructive" />
                  <span>Save error</span>
                </div>
              )}
              {profanityCount > 0 && (
                <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400" data-testid="status-profanity">
                  <span className="font-medium">{profanityCount} flagged</span>
                </div>
              )}
            </div>
          </div>
        </Card>
      )}

      <Card className="flex-1 flex flex-col min-h-0">
        <div className="p-3 border-b border-card-border">
          <h2 className="text-sm font-medium">Live Transcript</h2>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-3 space-y-3">
            {segments.map((segment, index) => (
              <TranscriptSegment
                key={index}
                segment={segment}
                isActive={false}
                onClick={() => {}}
                speakerColor={getSpeakerColor(segment.speaker)}
              />
            ))}
            {renderNonFinalTokens()}
            <div ref={endRef} />
          </div>
        </ScrollArea>
      </Card>

      {segments.length === 0 && !isRecording && (
        <Card className="p-8 text-center">
          <Mic className="h-12 w-12 mx-auto mb-3 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Click "Start Recording" to begin live transcription
          </p>
        </Card>
      )}

      {/* Configuration Dialog */}
      <Dialog open={showConfigDialog} onOpenChange={setShowConfigDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              Session Configuration (Optional)
            </DialogTitle>
            <DialogDescription>
              Configure topic and participation settings for this recording session. 
              Leave blank to use defaults.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            {/* Topic Configuration */}
            <div className="space-y-3">
              <h3 className="font-semibold text-sm">Topic Configuration</h3>
              
              <div className="space-y-2">
                <Label htmlFor="topic-prompt">Discussion Prompt/Question</Label>
                <Textarea
                  id="topic-prompt"
                  placeholder="e.g., 'Discuss the causes of climate change'"
                  value={topicPrompt}
                  onChange={(e) => setTopicPrompt(e.target.value)}
                  rows={3}
                />
                <p className="text-xs text-muted-foreground">
                  The main question or topic for this discussion
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="topic-keywords">Topic Keywords (comma-separated)</Label>
                <Input
                  id="topic-keywords"
                  placeholder="e.g., climate, environment, carbon, emissions"
                  value={topicKeywords}
                  onChange={(e) => setTopicKeywords(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Keywords that indicate the discussion is on-topic
                </p>
              </div>
            </div>

            <div className="border-t pt-4" />

            {/* Participation Configuration */}
            <div className="space-y-3">
              <h3 className="font-semibold text-sm">Participation Thresholds</h3>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="dominance-threshold">
                    Dominance Threshold (%)
                  </Label>
                  <Input
                    id="dominance-threshold"
                    type="number"
                    min="0"
                    max="100"
                    value={dominanceThreshold}
                    onChange={(e) => setDominanceThreshold(Number(e.target.value))}
                  />
                  <p className="text-xs text-muted-foreground">
                    Flag if one speaker exceeds this percentage (default: 50%)
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="silence-threshold">
                    Silence Threshold (%)
                  </Label>
                  <Input
                    id="silence-threshold"
                    type="number"
                    min="0"
                    max="100"
                    value={silenceThreshold}
                    onChange={(e) => setSilenceThreshold(Number(e.target.value))}
                  />
                  <p className="text-xs text-muted-foreground">
                    Flag if speaker is below this percentage (default: 5%)
                  </p>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                // Reset to defaults
                setTopicPrompt("");
                setTopicKeywords("");
                setDominanceThreshold(50);
                setSilenceThreshold(5);
                // Start recording with default values
                startRecording();
              }}
            >
              Skip
            </Button>
            <Button onClick={startRecording}>
              Start Recording
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
