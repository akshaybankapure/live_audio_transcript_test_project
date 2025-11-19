import { useState, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { 
  Mic, 
  MicOff, 
  Loader2, 
  Settings, 
  ArrowLeft,
  AlertTriangle,
  Users,
  Languages,
  Target,
  Flag,
  CheckCircle2,
  XCircle
} from "lucide-react";
import { SonioxClient } from "@soniox/speech-to-text-web";
import type { TranscriptSegment as TranscriptSegmentType, FlaggedContent } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { getSpeakerColor } from "@/lib/transcripts";
import { hasProfanity, highlightProfanity } from "@/lib/profanityDetector";

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

interface Alert {
  type: 'PROFANITY_ALERT' | 'LANGUAGE_POLICY_ALERT';
  flaggedWord: string;
  speaker: string;
  timestampMs: number;
  context?: string;
}

export default function LiveRecordingPanel({ selectedLanguage }: LiveRecordingPanelProps) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isRecording, setIsRecording] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [segments, setSegments] = useState<TranscriptSegmentType[]>([]);
  const [currentNonFinalTokens, setCurrentNonFinalTokens] = useState<Token[]>([]);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [showConfigDialog, setShowConfigDialog] = useState(false);
  const [topicPrompt, setTopicPrompt] = useState("");
  const [topicKeywords, setTopicKeywords] = useState("");
  const [dominanceThreshold, setDominanceThreshold] = useState(50);
  const [silenceThreshold, setSilenceThreshold] = useState(5);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const sonioxClientRef = useRef<SonioxClient | null>(null);
  // Store final tokens in a simple array, using a Set to track which we've seen
  // Key format: start_ms_end_ms_speaker_text (simple and effective)
  const finalTokensSetRef = useRef<Set<string>>(new Set());
  const finalTokensRef = useRef<Token[]>([]);
  const segmentsRef = useRef<TranscriptSegmentType[]>([]);
  const cleanupTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const transcriptIdRef = useRef<string | null>(null);
  const sonioxTranscriptionIdRef = useRef<string | null>(null);
  const lastSentIdxRef = useRef<number>(0);
  const savePromiseRef = useRef<Promise<void> | null>(null);
  const lastAppendTimeRef = useRef<number>(0);
  const wsRef = useRef<WebSocket | null>(null);

  // Track transcript ID in state so queries can react to changes
  const [transcriptId, setTranscriptId] = useState<string | null>(null);

  // Fetch flagged content for current transcript
  // Use the transcript endpoint which includes flaggedContent
  const { data: transcriptData } = useQuery<{ flaggedContent?: FlaggedContent[] }>({
    queryKey: ['/api/transcripts', transcriptId],
    enabled: !!transcriptId,
    refetchInterval: 2000, // Poll every 2 seconds for new flags
  });
  
  const flaggedContent = transcriptData?.flaggedContent || [];

  // WebSocket connection for real-time alerts
  useEffect(() => {
    // Connect to WebSocket for real-time alerts (connect even without transcriptId to receive all alerts)
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/monitor`);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('[LiveRecordingPanel] WebSocket connected');
      setIsConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.type === 'CONNECTED') {
          return;
        }

        // Handle alerts for this transcript (or all alerts if transcriptId not set yet)
        if (['PROFANITY_ALERT', 'LANGUAGE_POLICY_ALERT'].includes(data.type)) {
          // Only show alerts for current transcript, or if transcriptId not set yet, show all
          if (!transcriptId || data.transcriptId === transcriptId) {
            const alert: Alert = {
              type: data.type,
              flaggedWord: data.flaggedWord,
              speaker: data.speaker,
              timestampMs: data.timestampMs,
              context: data.context,
            };
            
            setAlerts((prev) => [alert, ...prev].slice(0, 50)); // Keep last 50 alerts
            
            // Show toast notification for immediate feedback
            toast({
              title: data.type === 'PROFANITY_ALERT' ? 'Profanity Detected' : 'Language Policy Violation',
              description: `${data.speaker}: "${data.flaggedWord}"`,
              variant: 'destructive',
              duration: 3000,
            });
          }
        }
      } catch (error) {
        console.error('[LiveRecordingPanel] Parse error:', error);
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
    };

    ws.onerror = (error) => {
      console.error('[LiveRecordingPanel] WebSocket error:', error);
      setIsConnected(false);
    };

    return () => {
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        ws.close();
      }
    };
  }, [transcriptId, toast]);

  useEffect(() => {
    return () => {
      if (sonioxClientRef.current) {
        sonioxClientRef.current.cancel();
      }
      if (cleanupTimeoutRef.current) {
        clearTimeout(cleanupTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  const getLanguageHints = () => {
    if (selectedLanguage === "auto") {
      return ["en", "es", "fr", "de", "pt", "hi", "zh", "ja", "ko"];
    }
    return [selectedLanguage];
  };

  // Process tokens into segments - matches server's parseTranscript approach
  // This is the standard way: process tokens sequentially, group by speaker, accumulate text
  const processTokensIntoSegments = (tokens: Token[]) => {
    if (tokens.length === 0) return [];

    const segments: TranscriptSegmentType[] = [];
    let currentSegment: TranscriptSegmentType | null = null;
    let currentSpeaker = "";
    let currentText = "";

    // Process tokens in chronological order (they should already be sorted)
    for (const token of tokens) {
      if (!token.is_final) continue;

      const speaker = token.speaker || "1";
      const speakerLabel = speaker.startsWith("SPEAKER") ? speaker : `SPEAKER ${speaker}`;
      const tokenText = token.text || "";
      const startTime = (token.start_ms || 0) / 1000;
      const endTime = (token.end_ms || 0) / 1000;

      // If speaker changed, save previous segment and start new one
      if (currentSpeaker !== speakerLabel) {
        // Save previous segment
        if (currentSegment) {
          segments.push(currentSegment);
        }

        // Start new segment
        currentSpeaker = speakerLabel;
        currentText = tokenText;
        currentSegment = {
          speaker: speakerLabel,
          text: currentText,
          startTime: startTime,
          endTime: endTime,
          language: token.language || "en",
        };
      } else {
        // Same speaker - continue accumulating text
        // Soniox tokens typically include leading spaces when needed (per server comment)
        // So we can just concatenate directly
        currentText += tokenText;
        if (currentSegment) {
          currentSegment.text = currentText;
          currentSegment.endTime = endTime; // Update end time to latest token
        }
      }
    }

    // Add final segment
    if (currentSegment) {
      segments.push(currentSegment);
    }

    return segments;
  };

  const createDraftTranscript = async (): Promise<string | null> => {
    try {
      const topicKeywordsArray = topicKeywords
        ? topicKeywords.split(',').map(k => k.trim()).filter(k => k.length > 0)
        : undefined;

      const participationConfig = {
        dominanceThreshold: dominanceThreshold / 100,
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

    const MAX_RETRIES = 3;
    const BASE_DELAY = 100;
    
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        setSaveStatus('saving');
        
        const fromIndex = lastSentIdxRef.current;
        const freshSegments = segmentsRef.current;
        const unsentSegments = freshSegments.slice(fromIndex);
        
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
            const errorData = await response.json();
            console.warn(`Index mismatch (attempt ${attempt + 1}/${MAX_RETRIES + 1}):`, errorData.error);
            
            const match = errorData.error?.match(/got (\d+)/);
            if (match) {
              lastSentIdxRef.current = parseInt(match[1], 10);
              const delay = BASE_DELAY * Math.pow(2, attempt);
              await new Promise(resolve => setTimeout(resolve, delay));
              continue;
            }
          }
          
          throw new Error(`Failed to append segments: ${response.status}`);
        }

        const result = await response.json();
        lastSentIdxRef.current = result.lastSegmentIdx || (fromIndex + unsentSegments.length);
        
        setSaveStatus('saved');
        lastAppendTimeRef.current = Date.now();
        return;
        
      } catch (error) {
        console.error(`Append failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}):`, error);
        
        if (attempt === MAX_RETRIES) {
          setSaveStatus('error');
          return;
        }
        
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
      const sonioxTranscriptionId = sonioxTranscriptionIdRef.current;

      const response = await fetch(`/api/transcripts/${transcriptId}/complete`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          duration,
          sonioxTranscriptionId,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to complete transcript");
      }

      toast({
        title: "Recording saved",
        description: "Transcript saved successfully",
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
    if (savePromiseRef.current || !transcriptIdRef.current) return;

    const currentSegments = segmentsRef.current;
    const unsentSegments = currentSegments.slice(lastSentIdxRef.current);

    const segmentThreshold = 5;
    const timeThreshold = 3000;
    const timeSinceLastAppend = Date.now() - lastAppendTimeRef.current;

    const shouldAppend = 
      unsentSegments.length >= segmentThreshold || 
      (unsentSegments.length > 0 && timeSinceLastAppend >= timeThreshold);

    if (shouldAppend) {
      const savePromise = appendSegments();
      savePromiseRef.current = savePromise;
      await savePromise;
      savePromiseRef.current = null;
    }
  };

  const handleStartRecording = () => {
    setShowConfigDialog(true);
  };

  const startRecording = async () => {
    try {
      setIsInitializing(true);
      setShowConfigDialog(false);
      
      let apiKey = import.meta.env.VITE_SONIOX_API_KEY;
      
      if (!apiKey) {
        try {
          const response = await fetch("/api/get-temp-api-key", {
            method: "POST",
          });
          if (response.ok) {
            const data = await response.json();
            apiKey = data.apiKey;
          }
        } catch (err) {
          console.error("Failed to fetch temporary API key:", err);
        }
      }

      if (!apiKey) {
        throw new Error("No Soniox API key available.");
      }

      const client = new SonioxClient({
        apiKey,
        bufferQueueSize: 1000,
      });

      sonioxClientRef.current = client;

      if (cleanupTimeoutRef.current) {
        clearTimeout(cleanupTimeoutRef.current);
        cleanupTimeoutRef.current = null;
      }

      // Reset token storage
      finalTokensSetRef.current.clear();
      finalTokensRef.current = [];
      setSegments([]);
      segmentsRef.current = [];
      setCurrentNonFinalTokens([]);
      setAlerts([]);
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
          if (result.tokens && result.tokens.length > 0) {
            // Process tokens: add final tokens to our collection, update partial tokens for preview
            result.tokens.forEach((token: Token) => {
              // Only process final tokens for segments (matching server approach)
              if (token.is_final) {
                const startMs = token.start_ms ?? 0;
                const endMs = token.end_ms ?? 0;
                const speaker = token.speaker || "1";
                const text = token.text || "";
                
                // Create a simple unique key to avoid exact duplicates
                // Use time range + speaker + text to identify unique tokens
                const tokenKey = `${startMs}_${endMs}_${speaker}_${text}`;
                
                // Only add if we haven't seen this exact token before
                // This handles cases where Soniox might send the same final token multiple times
                if (!finalTokensSetRef.current.has(tokenKey)) {
                  finalTokensSetRef.current.add(tokenKey);
                  finalTokensRef.current.push(token);
                }
              }
            });
            
            // Update non-final tokens for live preview
            const nonFinalTokens = result.tokens.filter((t: Token) => !t.is_final);
            setCurrentNonFinalTokens(nonFinalTokens);

            // Process all final tokens in chronological order
            // Sort by start time, then end time (matching server approach)
            const sortedFinalTokens = [...finalTokensRef.current].sort((a, b) => {
              const startDiff = (a.start_ms || 0) - (b.start_ms || 0);
              if (startDiff !== 0) return startDiff;
              return (a.end_ms || 0) - (b.end_ms || 0);
            });
            
            // Process into segments (matches server's parseTranscript logic)
            const newSegments = processTokensIntoSegments(sortedFinalTokens);
            
            segmentsRef.current = newSegments;
            setSegments(newSegments);

            tryAppendBatch();
          }
        },

        onStarted: async () => {
          console.log("Recording started");
          setIsRecording(true);
          setIsInitializing(false);

          const draftId = await createDraftTranscript();
          if (draftId) {
            transcriptIdRef.current = draftId;
            setTranscriptId(draftId); // Update state so queries can react
            console.log("Draft transcript created:", draftId);
          } else {
            toast({
              title: "Warning",
              description: "Failed to create draft transcript. Recording will not be auto-saved.",
              variant: "destructive",
            });
          }
        },

        onFinished: async (result?: any) => {
          console.log("Recording finished", result);
          setIsRecording(false);
          setCurrentNonFinalTokens([]);
          
          if (result?.transcription_id) {
            sonioxTranscriptionIdRef.current = result.transcription_id;
          }
          
          if (transcriptIdRef.current) {
            if (savePromiseRef.current) {
              await savePromiseRef.current;
            }

            if (segmentsRef.current.length > lastSentIdxRef.current) {
              await appendSegments();
            }

            await completeTranscript();

            cleanupTimeoutRef.current = setTimeout(() => {
              setSegments([]);
              segmentsRef.current = [];
              finalTokensSetRef.current.clear();
              finalTokensRef.current = [];
              transcriptIdRef.current = null;
              setTranscriptId(null); // Clear state
              sonioxTranscriptionIdRef.current = null;
              lastSentIdxRef.current = 0;
              setAlerts([]);
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
    }
  };

  // Calculate participation metrics
  const participationMetrics = () => {
    const speakerMap = new Map<string, { talkTime: number; segments: number }>();
    
    segments.forEach(segment => {
      const speaker = segment.speaker;
      const talkTime = segment.endTime - segment.startTime;
      const existing = speakerMap.get(speaker) || { talkTime: 0, segments: 0 };
      speakerMap.set(speaker, {
        talkTime: existing.talkTime + talkTime,
        segments: existing.segments + 1,
      });
    });

    const totalTalkTime = Array.from(speakerMap.values()).reduce((sum, s) => sum + s.talkTime, 0);
    const participation = Array.from(speakerMap.entries()).map(([speaker, data]) => ({
      speaker,
      percentage: totalTalkTime > 0 ? (data.talkTime / totalTalkTime) * 100 : 0,
      talkTime: data.talkTime,
    })).sort((a, b) => b.percentage - a.percentage);

    const isBalanced = participation.length === 0 || 
      (participation.length > 0 && participation[0].percentage <= 50 && 
       participation.every(p => p.percentage >= 5));

    return { participation, isBalanced };
  };

  // Get topic adherence (placeholder - would need to fetch from transcript)
  const topicAdherence = null; // Will be calculated on backend

  // Count flags
  const totalFlags = (flaggedContent?.length || 0) + alerts.length;
  const profanityFlags = (flaggedContent?.filter(f => f.flagType === 'profanity').length || 0) + 
    alerts.filter(a => a.type === 'PROFANITY_ALERT').length;
  const languageFlags = (flaggedContent?.filter(f => f.flagType === 'language_policy').length || 0) + 
    alerts.filter(a => a.type === 'LANGUAGE_POLICY_ALERT').length;

  // Check for non-English words in segments
  const hasNonEnglish = segments.some(s => s.language && s.language.toLowerCase() !== selectedLanguage.toLowerCase());

  // Format time for display (relative to recording start)
  const formatTime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  };


  const { participation, isBalanced } = participationMetrics();
  const activeAlerts = [...alerts, ...(flaggedContent?.map(f => ({
    type: f.flagType === 'profanity' ? 'PROFANITY_ALERT' as const : 'LANGUAGE_POLICY_ALERT' as const,
    flaggedWord: f.flaggedWord,
    speaker: f.speaker || 'Unknown',
    timestampMs: f.timestampMs,
    context: f.context || undefined,
  })) || [])].slice(0, 10); // Show last 10 alerts

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-background">
      {/* Header */}
      <div className="flex-shrink-0 px-4 py-3 border-b bg-background">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLocation('/')}
              className="gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              Exit
            </Button>
            <div>
              <h1 className="text-xl font-bold">Discussion Monitor</h1>
            </div>
          </div>
          {isRecording && (
            <div className="flex items-center gap-3">
              <Button
                variant="destructive"
                size="sm"
                onClick={stopRecording}
                className="gap-2"
              >
                <MicOff className="h-4 w-4" />
                Stop Recording
              </Button>
              <div className="flex items-center gap-2 px-3 py-1.5 bg-black text-white rounded-full">
                <div className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                <span className="text-sm font-medium">Recording</span>
              </div>
            </div>
          )}
        </div>

        {/* Discussion Topic */}
        {topicPrompt && (
          <div className="mt-2">
            <p className="text-sm text-muted-foreground">
              <span className="font-medium">Discussion Topic:</span> {topicPrompt}
            </p>
          </div>
        )}

        {/* Status Bars */}
        {!isRecording && segments.length === 0 && (
          <>
            <div className="mt-3 px-3 py-2 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded">
              <p className="text-xs text-blue-700 dark:text-blue-300">
                Microphone not available. Using demo mode for testing.
              </p>
            </div>
            <div className="mt-2">
              <Button
                variant="destructive"
                size="sm"
                onClick={handleStartRecording}
                className="w-full"
              >
                <Mic className="h-4 w-4 mr-2" />
                Start Recording
              </Button>
            </div>
          </>
        )}
      </div>

      {/* Main Content - Two Column Layout */}
      <div className="flex-1 overflow-hidden flex gap-4 p-4">
        {/* Left Column - Live Transcript */}
        <div className="flex-1 flex flex-col min-w-0">
          <Card className="flex-1 flex flex-col min-h-0">
            <CardHeader className="flex-shrink-0 pb-3">
              <CardTitle className="text-base">Live Transcript</CardTitle>
            </CardHeader>
            <CardContent className="flex-1 overflow-hidden p-0">
              <ScrollArea className="h-full">
                <div className="p-4 space-y-3">
                  {segments.map((segment, index) => {
                    const speakerColor = getSpeakerColor(segment.speaker);
                    const isNonEnglish = segment.language && 
                      segment.language.toLowerCase() !== selectedLanguage.toLowerCase();
                    
                    return (
                      <div key={index} className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="secondary" className="text-xs">
                            {segment.speaker}
                          </Badge>
                          <span className="text-xs text-muted-foreground font-mono">
                            {formatTime(segment.startTime)}
                          </span>
                          {isNonEnglish && (
                            <Badge variant="outline" className="text-xs border-purple-500 text-purple-700 bg-purple-50">
                              {segment.language} detected
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm leading-relaxed">
                          {highlightProfanity(segment.text).map((part, idx) => 
                            part.isProfanity ? (
                              <mark
                                key={idx}
                                className="bg-red-200 dark:bg-red-900/50 text-red-900 dark:text-red-200 px-0.5 rounded font-semibold"
                              >
                                {part.text}
                              </mark>
                            ) : (
                              <span key={idx}>{part.text}</span>
                            )
                          )}
                        </p>
                      </div>
                    );
                  })}
                  {segments.length === 0 && !isRecording && (
                    <div className="text-center py-12">
                      <p className="text-sm text-muted-foreground">
                        {!isRecording ? "Click 'Start Recording' to begin" : "Waiting for audio..."}
                      </p>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>

        {/* Right Column - Metrics */}
        <div className="w-80 flex-shrink-0 flex flex-col gap-3">
          {/* Active Alerts */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                Active Alerts
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {activeAlerts.length > 0 ? (
                activeAlerts.map((alert, idx) => (
                  <div
                    key={idx}
                    className="p-2 border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/20 rounded text-xs"
                  >
                    {alert.type === 'PROFANITY_ALERT' 
                      ? `Inappropriate language detected from ${alert.speaker}`
                      : `Non-English language detected from ${alert.speaker}`
                    }
                  </div>
                ))
              ) : (
                <p className="text-xs text-muted-foreground">No active alerts</p>
              )}
            </CardContent>
          </Card>

          {/* Participation */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Users className="h-4 w-4" />
                Participation
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {participation.length > 0 ? (
                <>
                  {participation.map((p) => (
                    <div key={p.speaker} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span>{p.speaker}</span>
                        <span className="font-medium">{p.percentage.toFixed(0)}%</span>
                      </div>
                      <div className="w-full bg-muted rounded-full h-2">
                        <div
                          className="h-2 rounded-full bg-black dark:bg-white transition-all"
                          style={{ width: `${p.percentage}%` }}
                        />
                      </div>
                    </div>
                  ))}
                  <Badge variant={isBalanced ? "default" : "destructive"} className="w-full justify-center">
                    {isBalanced ? "Balanced" : "Imbalanced"}
                  </Badge>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">No participation data yet</p>
              )}
            </CardContent>
          </Card>

          {/* On Topic */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Target className="h-4 w-4" />
                On Topic
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {topicAdherence !== null ? (
                <>
                  <p className="text-2xl font-bold">{Math.round(topicAdherence * 100)}%</p>
                  <div className="w-full bg-muted rounded-full h-2">
                    <div
                      className={`h-2 rounded-full transition-all ${
                        topicAdherence >= 0.7 ? 'bg-green-600' : 
                        topicAdherence >= 0.5 ? 'bg-yellow-600' : 'bg-red-600'
                      }`}
                      style={{ width: `${topicAdherence * 100}%` }}
                    />
                  </div>
                  <Badge variant={topicAdherence >= 0.7 ? "default" : "destructive"} className="w-full justify-center">
                    {topicAdherence >= 0.7 ? "Good" : topicAdherence >= 0.5 ? "Moderate" : "Drifting"}
                  </Badge>
                </>
              ) : (
                <>
                  <p className="text-2xl font-bold">--</p>
                  <p className="text-xs text-muted-foreground">Calculated at session end</p>
                </>
              )}
            </CardContent>
          </Card>

          {/* Language */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Languages className="h-4 w-4" />
                Language
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Badge variant="outline" className="w-full justify-center py-2">
                {selectedLanguage === 'auto' ? 'Auto-detect' : selectedLanguage.toUpperCase()} Only
              </Badge>
              {hasNonEnglish && (
                <p className="text-xs text-muted-foreground">Non-English flagged</p>
              )}
            </CardContent>
          </Card>

          {/* Total Flags */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Flag className="h-4 w-4 text-destructive" />
                Total Flags
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-destructive">{totalFlags}</p>
              {totalFlags > 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  {profanityFlags + languageFlags} high priority
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

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
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            <div className="space-y-3">
              <h3 className="font-semibold text-sm">Topic Configuration</h3>
              
              <div className="space-y-2">
                <Label htmlFor="topic-prompt">Discussion Prompt/Question</Label>
                <Textarea
                  id="topic-prompt"
                  placeholder="e.g., 'Discuss the impact of technology on education'"
                  value={topicPrompt}
                  onChange={(e) => setTopicPrompt(e.target.value)}
                  rows={3}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="topic-keywords">Topic Keywords (comma-separated)</Label>
                <Input
                  id="topic-keywords"
                  placeholder="e.g., technology, education, learning"
                  value={topicKeywords}
                  onChange={(e) => setTopicKeywords(e.target.value)}
                />
              </div>
            </div>

            <div className="border-t pt-4" />

            <div className="space-y-3">
              <h3 className="font-semibold text-sm">Participation Thresholds</h3>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="dominance-threshold">Dominance Threshold (%)</Label>
                  <Input
                    id="dominance-threshold"
                    type="number"
                    min="0"
                    max="100"
                    value={dominanceThreshold}
                    onChange={(e) => setDominanceThreshold(Number(e.target.value))}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="silence-threshold">Silence Threshold (%)</Label>
                  <Input
                    id="silence-threshold"
                    type="number"
                    min="0"
                    max="100"
                    value={silenceThreshold}
                    onChange={(e) => setSilenceThreshold(Number(e.target.value))}
                  />
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setTopicPrompt("");
                setTopicKeywords("");
                setDominanceThreshold(50);
                setSilenceThreshold(5);
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
