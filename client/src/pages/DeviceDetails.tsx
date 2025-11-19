import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useRoute } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  ArrowLeft, 
  Users, 
  Flag, 
  FileText, 
  AlertTriangle, 
  Languages, 
  MessageSquareX, 
  UserX,
  Calendar as CalendarIcon,
  Clock,
  TrendingUp,
  TrendingDown,
  BarChart3,
  PieChart,
  Activity,
  RefreshCw,
  Target,
  MessageSquare,
  Volume2,
  CheckCircle,
  XCircle
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { format } from "date-fns";
import type { Transcript, FlaggedContent, User, TranscriptSegment } from "@shared/schema";
import TranscriptSegmentComponent from "@/components/TranscriptSegment";
import { getSpeakerColor } from "@/lib/transcripts";
import { hasProfanity } from "@/lib/profanityDetector";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

type FlaggedContentWithTranscript = FlaggedContent & { transcript: Transcript };

interface DeviceDashboard {
  user: User;
  sessions: Transcript[];
  flaggedContent: FlaggedContentWithTranscript[];
}

interface SpeakerAnalytics {
  speakerId: string;
  totalSegments: number;
  totalTalkTime: number;
  percentage: number;
  profanityCount: number;
  languagePolicyCount: number;
  offTopicCount: number;
  participationFlags: number;
  segments: TranscriptSegment[];
}

export default function DeviceDetails() {
  const [, params] = useRoute("/dashboard/device/:deviceId");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const deviceId = params?.deviceId || null;

  const [timeRange, setTimeRange] = useState<'1h' | '12h' | 'today' | 'live' | 'all' | 'custom' | 'session'>('live');
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const [customStartDate, setCustomStartDate] = useState<string>('');
  const [customEndDate, setCustomEndDate] = useState<string>('');
  const [appliedDateRange, setAppliedDateRange] = useState<{ start: string; end: string } | null>(null);

  const { data: deviceData, isLoading } = useQuery<DeviceDashboard>({
    queryKey: ["/api/dashboard/device", deviceId],
    enabled: !!deviceId,
    refetchOnMount: true, // Always refetch to get latest sessions
    staleTime: 0, // Always consider data stale to get fresh sessions
    refetchInterval: 5000, // Refetch every 5 seconds while on this page to see new sessions
  });

  // Filter sessions by time range
  const getTimeRangeFilter = (date: Date): boolean => {
    const now = new Date();
    const recordDate = new Date(date);
    
    switch (timeRange) {
      case '1h':
        return recordDate >= new Date(now.getTime() - 60 * 60 * 1000);
      case '12h':
        return recordDate >= new Date(now.getTime() - 12 * 60 * 60 * 1000);
      case 'today':
        const todayStart = new Date(now);
        todayStart.setHours(0, 0, 0, 0);
        return recordDate >= todayStart;
      case 'live':
        return recordDate >= new Date(now.getTime() - 24 * 60 * 60 * 1000);
      case 'custom':
        if (appliedDateRange) {
          const start = new Date(appliedDateRange.start);
          start.setHours(0, 0, 0, 0);
          const end = new Date(appliedDateRange.end);
          end.setHours(23, 59, 59, 999);
          return recordDate >= start && recordDate <= end;
        }
        return true;
      case 'all':
      default:
        return true;
    }
  };

  // Filter sessions by time range, date, and session
  const filteredSessions = deviceData?.sessions.filter(session => {
    // Time range filter
    if (timeRange !== 'session' && !getTimeRangeFilter(new Date(session.createdAt || ''))) {
      return false;
    }
    
    // Date filter (for custom date picker)
    if (selectedDate) {
      const sessionDate = new Date(session.createdAt || '');
      if (
        sessionDate.getDate() !== selectedDate.getDate() ||
        sessionDate.getMonth() !== selectedDate.getMonth() ||
        sessionDate.getFullYear() !== selectedDate.getFullYear()
      ) {
        return false;
      }
    }
    
    // Session filter
    if (timeRange === 'session' && selectedSessionId && session.id !== selectedSessionId) {
      return false;
    }
    
    return true;
  }) || [];

  // Debug logging
  useEffect(() => {
    if (deviceData) {
      console.log('[DeviceDetails] Sessions data:', {
        total: deviceData.sessions.length,
        filtered: filteredSessions.length,
        timeRange,
        sessions: deviceData.sessions.map(s => ({
          id: s.id,
          status: s.status,
          segmentsCount: Array.isArray(s.segments) ? s.segments.length : (typeof s.segments === 'string' ? JSON.parse(s.segments || '[]').length : 0),
          createdAt: s.createdAt,
        })),
      });
    }
  }, [deviceData, filteredSessions.length, timeRange]);

  // Filter flagged content by time range, date, and session
  const filteredFlags = deviceData?.flaggedContent.filter(flag => {
    // Time range filter
    if (timeRange !== 'session' && !getTimeRangeFilter(new Date(flag.createdAt || ''))) {
      return false;
    }
    
    // Date filter
    if (selectedDate) {
      const flagDate = new Date(flag.createdAt || '');
      if (
        flagDate.getDate() !== selectedDate.getDate() ||
        flagDate.getMonth() !== selectedDate.getMonth() ||
        flagDate.getFullYear() !== selectedDate.getFullYear()
      ) {
        return false;
      }
    }
    
    // Session filter
    if (timeRange === 'session' && selectedSessionId && flag.transcriptId !== selectedSessionId) {
      return false;
    } else if (selectedSessionId && flag.transcriptId !== selectedSessionId) {
      return false;
    }
    
    return true;
  }) || [];

  // Calculate speaker analytics
  const speakerAnalytics = (): SpeakerAnalytics[] => {
    if (!deviceData) return [];

    // Use filtered sessions for analytics
    const sessionsToAnalyze = filteredSessions;

    const speakerMap = new Map<string, SpeakerAnalytics>();

    sessionsToAnalyze.forEach(session => {
      const segments: TranscriptSegment[] = typeof session.segments === 'string'
        ? JSON.parse(session.segments)
        : session.segments || [];

      segments.forEach(segment => {
        const speakerId = segment.speaker;
        const existing = speakerMap.get(speakerId) || {
          speakerId,
          totalSegments: 0,
          totalTalkTime: 0,
          percentage: 0,
          profanityCount: 0,
          languagePolicyCount: 0,
          offTopicCount: 0,
          participationFlags: 0,
          segments: [],
        };

        existing.totalSegments++;
        existing.totalTalkTime += segment.endTime - segment.startTime;
        existing.segments.push(segment);
        speakerMap.set(speakerId, existing);
      });
    });

    // Count flags per speaker
    filteredFlags.forEach(flag => {
      const analytics = speakerMap.get(flag.speaker || '');
      if (analytics) {
        switch (flag.flagType) {
          case 'profanity':
            analytics.profanityCount++;
            break;
          case 'language_policy':
            analytics.languagePolicyCount++;
            break;
          case 'off_topic':
            analytics.offTopicCount++;
            break;
          case 'participation':
            analytics.participationFlags++;
            break;
        }
      }
    });

    // Calculate percentages
    const totalTalkTime = Array.from(speakerMap.values()).reduce(
      (sum, s) => sum + s.totalTalkTime,
      0
    );

    const analytics = Array.from(speakerMap.values()).map(s => ({
      ...s,
      percentage: totalTalkTime > 0 ? (s.totalTalkTime / totalTalkTime) * 100 : 0,
    }));

    return analytics.sort((a, b) => b.percentage - a.percentage);
  };

  const analytics = speakerAnalytics();
  const totalFlags = filteredFlags.length;
  const profanityFlags = filteredFlags.filter(f => f.flagType === 'profanity').length;
  const languageFlags = filteredFlags.filter(f => f.flagType === 'language_policy').length;
  const offTopicFlags = filteredFlags.filter(f => f.flagType === 'off_topic').length;
  const participationFlags = filteredFlags.filter(f => f.flagType === 'participation').length;

  // Get session for transcript display - use selected session if available, otherwise most recent
  const displaySession = selectedSessionId 
    ? filteredSessions.find(s => s.id === selectedSessionId)
    : filteredSessions.length > 0 
      ? filteredSessions.sort((a, b) => new Date(b.createdAt || '').getTime() - new Date(a.createdAt || '').getTime())[0]
      : null;
  
  const recentSessionSegments: TranscriptSegment[] = displaySession 
    ? (typeof displaySession.segments === 'string'
        ? JSON.parse(displaySession.segments)
        : displaySession.segments || [])
    : [];

  // Get recent flags for display - filter by selected session if applicable
  const displayFlags = selectedSessionId
    ? filteredFlags.filter(f => f.transcriptId === selectedSessionId)
    : filteredFlags;
    
  const recentFlags = displayFlags
    .sort((a, b) => new Date(b.createdAt || '').getTime() - new Date(a.createdAt || '').getTime())
    .slice(0, 5);

  // Calculate topic adherence from display session
  const topicAdherence = displaySession?.topicAdherenceScore !== null && displaySession?.topicAdherenceScore !== undefined
    ? Math.round((displaySession.topicAdherenceScore || 0) * 100)
    : null;

  // Check if participation is balanced
  const participationBalance = displaySession?.participationBalance as any;
  let isParticipationBalanced = true;
  if (participationBalance) {
    if (participationBalance.speakers && Array.isArray(participationBalance.speakers)) {
      const maxPercentage = Math.max(...participationBalance.speakers.map((s: any) => (s.percentage || 0) * 100));
      isParticipationBalanced = maxPercentage < 50; // Balanced if no one dominates >50%
    }
  }

  const formatTimestamp = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };
  
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const formatDateTime = (dateString: string | null | Date) => {
    if (!dateString) return 'Unknown';
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (!deviceId) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardContent className="text-center py-12">
            <p className="text-muted-foreground">No device selected</p>
            <Button onClick={() => setLocation('/dashboard')} className="mt-4">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b px-6 py-4 flex-shrink-0">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLocation('/dashboard')}
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to All Groups
            </Button>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">
                {deviceData?.user.displayName || 'Device Details'}
              </h1>
              <p className="text-sm text-gray-500 mt-0.5">
                Analysis and insights for this group
              </p>
            </div>
          </div>
        </div>
        
        {/* Filter Tabs */}
        <div className="mt-3">
          <Tabs value={timeRange} onValueChange={(v) => {
            setTimeRange(v as 'live' | 'all' | 'custom' | 'session' | '1h' | '12h' | 'today');
            // Reset filters when switching modes
            if (v !== 'custom') {
              setCustomStartDate('');
              setCustomEndDate('');
              setAppliedDateRange(null);
              setSelectedDate(undefined);
            }
            if (v !== 'session') {
              setSelectedSessionId(null);
            }
          }}>
            <TabsList className="h-9 flex-wrap gap-1">
              <TabsTrigger value="1h" className="text-xs px-2.5">
                <Clock className="h-3 w-3 mr-1" />
                Last 1hr
              </TabsTrigger>
              <TabsTrigger value="12h" className="text-xs px-2.5">
                <Clock className="h-3 w-3 mr-1" />
                Last 12hr
              </TabsTrigger>
              <TabsTrigger value="today" className="text-xs px-2.5">
                <CalendarIcon className="h-3 w-3 mr-1" />
                Today
              </TabsTrigger>
              <TabsTrigger value="live" className="text-xs px-2.5">
                <Activity className="h-3 w-3 mr-1" />
                Live (24h)
              </TabsTrigger>
              <TabsTrigger value="all" className="text-xs px-2.5">
                All Time
              </TabsTrigger>
              <TabsTrigger value="custom" className="text-xs px-2.5">
                <CalendarIcon className="h-3 w-3 mr-1" />
                Custom Range
              </TabsTrigger>
              <TabsTrigger value="session" className="text-xs px-2.5">
                <FileText className="h-3 w-3 mr-1" />
                Specific Session
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="custom" className="mt-3">
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <label htmlFor="custom-start-date" className="text-xs text-muted-foreground mb-1.5 block">
                    Start Date
                  </label>
                  <input
                    id="custom-start-date"
                    type="date"
                    value={customStartDate}
                    onChange={(e) => setCustomStartDate(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </div>
                <div className="flex-1">
                  <label htmlFor="custom-end-date" className="text-xs text-muted-foreground mb-1.5 block">
                    End Date
                  </label>
                  <input
                    id="custom-end-date"
                    type="date"
                    value={customEndDate}
                    onChange={(e) => setCustomEndDate(e.target.value)}
                    min={customStartDate}
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </div>
                <Button
                  size="sm"
                  onClick={() => {
                    if (customStartDate && customEndDate) {
                      setAppliedDateRange({ start: customStartDate, end: customEndDate });
                    }
                  }}
                  disabled={!customStartDate || !customEndDate}
                  className="h-9 text-xs"
                >
                  Apply
                </Button>
              </div>
            </TabsContent>
            
            <TabsContent value="session" className="mt-3">
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <label htmlFor="session-select" className="text-xs text-muted-foreground mb-1.5 block">
                    Select Session
                  </label>
                  <Select value={selectedSessionId || "all"} onValueChange={(value) => setSelectedSessionId(value === "all" ? null : value)}>
                    <SelectTrigger id="session-select" className="h-9 text-xs">
                      <SelectValue placeholder="Choose a session..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Sessions</SelectItem>
                      {deviceData?.sessions.map(session => (
                        <SelectItem key={session.id} value={session.id} className="text-xs">
                          <div className="flex flex-col">
                            <span className="font-medium">{session.title}</span>
                            <span className="text-xs text-muted-foreground">
                              {formatDateTime(session.createdAt)}
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setSelectedSessionId(null)}
                  disabled={!selectedSessionId}
                  className="h-9 text-xs"
                >
                  Clear
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </header>

      {/* Main Content - 2 Column Layout */}
      {isLoading ? (
        <div className="flex-1 p-6">
          <div className="grid grid-cols-2 gap-6">
            <Skeleton className="h-full" />
            <Skeleton className="h-full" />
          </div>
        </div>
      ) : deviceData ? (
        <div className="flex-1 overflow-hidden p-6">
          <div className="grid grid-cols-2 gap-6 h-full max-h-[calc(100vh-200px)]">
            {/* Left Column - Live Transcript */}
            <Card className="p-4 flex flex-col">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-semibold">Live Transcript</h3>
                <Badge variant="outline">
                  <MessageSquare className="h-3 w-3 mr-1" />
                  {recentSessionSegments.length} messages
                </Badge>
              </div>
              <ScrollArea className="flex-1">
                <div className="space-y-3 pr-3">
                  {recentSessionSegments.length === 0 ? (
                    <div className="text-center py-12 text-gray-400">
                      No transcript available
                    </div>
                  ) : (
                    recentSessionSegments.map((segment, idx) => {
                      const hasFlag = displayFlags.some(f => 
                        f.transcriptId === displaySession?.id &&
                        Math.abs(f.timestampMs - segment.startTime * 1000) < 1000
                      );
                      return (
                        <div 
                          key={idx}
                          className={`p-3 rounded-lg border-l-2 ${
                            hasFlag 
                              ? 'bg-red-50 border-l-red-500' 
                              : 'bg-gray-50 border-l-gray-300'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <Badge variant="outline" className="text-xs">
                              {segment.speaker}
                            </Badge>
                            <span className="text-xs text-gray-500">{formatTime(segment.startTime)}</span>
                          </div>
                          <p className="text-sm text-gray-700 leading-relaxed">{segment.text}</p>
                          {hasFlag && (
                            <Badge variant="destructive" className="text-xs mt-2">
                              <AlertTriangle className="h-3 w-3 mr-1" />
                              Flagged
                            </Badge>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </ScrollArea>
            </Card>

            {/* Right Column - Overview, Metrics & Alerts */}
            <div className="space-y-4 overflow-auto">
              {/* Group Info */}
              <Card className="p-4">
                <div className="flex items-center gap-3 mb-3">
                  <div className={`h-12 w-12 rounded-full ${
                    displaySession ? 'bg-green-100' : 'bg-gray-100'
                  } flex items-center justify-center`}>
                    <Users className={`h-6 w-6 ${
                      displaySession ? 'text-green-600' : 'text-gray-400'
                    }`} />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold">{deviceData.user.displayName || 'Unknown Device'}</h3>
                    <p className="text-sm text-gray-500">
                      {analytics.length} students
                      {selectedSessionId && displaySession && (
                        <span className="ml-2 text-xs">• {displaySession.title}</span>
                      )}
                    </p>
                  </div>
                  <Badge variant={displaySession ? "default" : "outline"}>
                    {displaySession ? 'Live' : 'Paused'}
                  </Badge>
                </div>
                {displaySession?.topicPrompt && (
                  <div className="bg-blue-50 border border-blue-200 rounded p-3">
                    <div className="text-xs text-blue-700 mb-1">Topic</div>
                    <div className="text-sm text-blue-900">{displaySession.topicPrompt}</div>
                  </div>
                )}
              </Card>

              {/* Critical Alerts */}
              {recentFlags.length > 0 && (
                <Card className="p-4 border-l-4 border-l-red-500 bg-red-50">
                  <div className="flex items-center gap-2 mb-3">
                    <AlertTriangle className="h-5 w-5 text-red-600" />
                    <h3 className="text-sm text-red-900 font-semibold">Critical Alerts</h3>
                  </div>
                  <div className="space-y-2">
                    {recentFlags.slice(0, 3).map((flag, idx) => (
                      <div key={flag.id} className="p-2 bg-white rounded border border-red-200">
                        <div className="flex items-start gap-2">
                          <Badge variant="destructive" className="text-xs shrink-0">
                            {flag.flagType === 'profanity' ? 'high' : flag.flagType === 'language_policy' ? 'high' : 'medium'}
                          </Badge>
                          <p className="text-xs text-red-900 flex-1">{flag.flaggedWord || flag.context || 'Alert'}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {/* Metrics Grid */}
              <div className="grid grid-cols-2 gap-4">
                {/* Topic Adherence */}
                {topicAdherence !== null && (
                  <Card className="p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Target className="h-4 w-4 text-green-600" />
                      <h3 className="text-sm font-semibold">On Topic</h3>
                    </div>
                    <div className="flex items-center justify-center py-4">
                      <div className="text-center">
                        <div className="text-3xl mb-2">{topicAdherence}%</div>
                        <Progress value={topicAdherence} className="h-2 w-28 mx-auto" />
                      </div>
                    </div>
                    <Badge 
                      variant={topicAdherence > 70 ? "default" : "destructive"}
                      className="w-full justify-center mt-3"
                    >
                      {topicAdherence > 70 ? 'Good' : 'Drifting'}
                    </Badge>
                  </Card>
                )}

                {/* Participation */}
                <Card className="p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Users className="h-4 w-4 text-blue-600" />
                    <h3 className="text-sm font-semibold">Participation</h3>
                  </div>
                  <div className="flex items-center justify-center py-4">
                    <Badge 
                      variant={isParticipationBalanced ? "default" : "destructive"}
                      className="px-4 py-2"
                    >
                      {isParticipationBalanced ? 'Balanced' : 'Imbalanced'}
                    </Badge>
                  </div>
                </Card>

                {/* Profanity Flags */}
                <Card className="p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <AlertTriangle className="h-4 w-4 text-red-600" />
                    <h3 className="text-sm font-semibold">Profanity</h3>
                  </div>
                  <div className="text-center py-4">
                    <div className="text-3xl text-red-600">
                      {selectedSessionId 
                        ? displayFlags.filter(f => f.flagType === 'profanity').length
                        : profanityFlags}
                    </div>
                  </div>
                  <div className="text-sm text-gray-500 text-center mt-3">
                    Inappropriate words
                  </div>
                </Card>

                {/* Language Flags */}
                <Card className="p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Languages className="h-4 w-4 text-purple-600" />
                    <h3 className="text-sm font-semibold">Language</h3>
                  </div>
                  <div className="text-center py-4">
                    <div className="text-3xl text-purple-600">
                      {selectedSessionId 
                        ? displayFlags.filter(f => f.flagType === 'language_policy').length
                        : languageFlags}
                    </div>
                  </div>
                  <div className="text-sm text-gray-500 text-center mt-3">
                    Non-English detected
                  </div>
                </Card>
              </div>

              {/* Speakers */}
              {analytics.length > 0 && (
                <Card className="p-4">
                  <h3 className="text-sm font-semibold mb-3">Speakers</h3>
                  <div className="space-y-2.5">
                    {analytics.map(speaker => {
                      const color = getSpeakerColor(speaker.speakerId);
                      const totalSpeakerFlags = speaker.profanityCount + speaker.languagePolicyCount + speaker.offTopicCount + speaker.participationFlags;
                      return (
                        <div key={speaker.speakerId}>
                          <div className="flex items-center justify-between text-sm mb-1">
                            <div className="flex items-center gap-2">
                              <div className="h-3 w-3 rounded-full" style={{ backgroundColor: color }}></div>
                              <span>{speaker.speakerId}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-gray-600">{speaker.percentage.toFixed(0)}%</span>
                              {totalSpeakerFlags > 0 ? (
                                <XCircle className="h-3 w-3 text-red-600" />
                              ) : (
                                <CheckCircle className="h-3 w-3 text-green-600" />
                              )}
                            </div>
                          </div>
                          <Progress value={speaker.percentage} className="h-2" />
                        </div>
                      );
                    })}
                  </div>
                </Card>
              )}

              {/* Recent Flags */}
              {recentFlags.length > 0 && (
                <Card className="p-4">
                  <h3 className="text-sm font-semibold mb-3">Recent Flags</h3>
                  <div className="space-y-2">
                    {recentFlags.map((flag) => (
                      <div key={flag.id} className="p-2 bg-orange-50 border border-orange-200 rounded-lg">
                        <div className="flex items-start gap-2 mb-1">
                          <Badge 
                            variant="outline" 
                            className={`text-xs shrink-0 ${
                              flag.flagType === 'profanity' ? 'bg-red-100 text-red-700' :
                              flag.flagType === 'language_policy' ? 'bg-purple-100 text-purple-700' :
                              'bg-orange-100 text-orange-700'
                            }`}
                          >
                            {flag.flagType}
                          </Badge>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-gray-700 truncate">{flag.speaker || 'Unknown'}</p>
                          </div>
                          <span className="text-xs text-gray-500 shrink-0">{formatTimestamp(flag.timestampMs)}</span>
                        </div>
                        <p className="text-xs text-gray-600">{flag.flaggedWord || flag.context || 'Flagged content'}</p>
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {/* Actions */}
              <div className="grid grid-cols-2 gap-3">
                <Button variant="outline">
                  <Volume2 className="h-4 w-4 mr-2" />
                  Listen
                </Button>
                <Button variant="outline">
                  Export
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <Card className="m-4">
          <CardContent className="text-center py-12">
            <p className="text-muted-foreground">Device not found</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
