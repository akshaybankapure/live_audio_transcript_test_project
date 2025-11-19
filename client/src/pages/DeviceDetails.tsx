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
  RefreshCw
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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

    const sessionsToAnalyze = selectedSessionId
      ? deviceData.sessions.filter(s => s.id === selectedSessionId)
      : filteredSessions;

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

  const formatTimestamp = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
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
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 px-2 sm:px-4 py-2 sm:py-3 border-b bg-background">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLocation('/dashboard')}
              className="h-8 flex-shrink-0"
            >
              <ArrowLeft className="h-4 w-4 sm:mr-1.5" />
              <span className="hidden sm:inline">Back</span>
            </Button>
            <div className="min-w-0">
              <h1 className="text-lg sm:text-2xl font-bold tracking-tight truncate">
                {deviceData?.user.displayName || 'Device Details'}
              </h1>
              <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 line-clamp-1">
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
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden flex flex-col p-2 sm:p-4">
      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-16 w-full" />
          <div className="grid grid-cols-[300px,1fr] gap-4">
            <Skeleton className="h-96" />
            <Skeleton className="h-96" />
          </div>
        </div>
      ) : deviceData ? (
        <>
          {/* Compact Horizontal Summary Bar */}
          <div className="flex-shrink-0 mb-3">
            <Card className="p-2 sm:p-3">
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 sm:gap-4 items-center">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground font-medium">Sessions</p>
                    <p className="text-lg font-bold">{filteredSessions.length}</p>
                  </div>
                </div>
                
                <div className="flex items-center gap-2">
                  <Flag className={`h-4 w-4 ${totalFlags > 0 ? 'text-destructive' : 'text-muted-foreground'}`} />
                  <div>
                    <p className="text-xs text-muted-foreground font-medium">Flags</p>
                    <p className={`text-lg font-bold ${totalFlags > 0 ? 'text-destructive' : ''}`}>{totalFlags}</p>
                  </div>
                </div>
                
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground font-medium">Speakers</p>
                    <p className="text-lg font-bold">{analytics.length}</p>
                  </div>
                </div>
                
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground font-medium">Talk Time</p>
                    <p className="text-lg font-bold">
                      {Math.round(analytics.reduce((sum, s) => sum + s.totalTalkTime, 0) / 60)}m
                    </p>
                  </div>
                </div>
                
                <div className="col-span-2 flex items-center gap-3 text-xs">
                  <div className="flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3 text-destructive" />
                    <span className="font-medium">{profanityFlags}</span>
                    <span className="text-muted-foreground">Profanity</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Languages className="h-3 w-3 text-orange-600" />
                    <span className="font-medium">{languageFlags}</span>
                    <span className="text-muted-foreground">Language</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <MessageSquareX className="h-3 w-3 text-yellow-600" />
                    <span className="font-medium">{offTopicFlags}</span>
                    <span className="text-muted-foreground">Off-Topic</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <UserX className="h-3 w-3 text-blue-600" />
                    <span className="font-medium">{participationFlags}</span>
                    <span className="text-muted-foreground">Participation</span>
                  </div>
                </div>
              </div>
            </Card>
          </div>

          {/* Two-Column Layout */}
          <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-[280px,1fr] gap-2 min-h-0 lg:pr-2">
            {/* Left: Speaker Analytics Sidebar */}
            <Card className="flex flex-col min-h-0">
              <CardHeader className="flex-shrink-0 pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <BarChart3 className="h-4 w-4" />
                  Speakers ({analytics.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="flex-1 overflow-hidden p-3">
                <ScrollArea className="h-full">
                  <div className="space-y-2">
                {analytics.length > 0 ? (
                  analytics.map((speaker, index) => {
                    const color = getSpeakerColor(speaker.speakerId);
                    // Percentage is already in 0-100 format from analytics calculation
                    const isDominant = speaker.percentage > 50;
                    const isSilent = speaker.percentage < 5;
                    
                    const totalSpeakerFlags = speaker.profanityCount + speaker.languagePolicyCount + speaker.offTopicCount + speaker.participationFlags;
                    
                    return (
                      <div key={speaker.speakerId} className="p-2.5 border border-border rounded-lg hover:bg-muted/50 transition-colors">
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="flex items-center gap-1.5 min-w-0 flex-1">
                            <div
                              className="w-2.5 h-2.5 rounded-full flex-shrink-0 mt-0.5"
                              style={{ backgroundColor: color }}
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5 mb-0.5">
                                <p className="text-xs font-semibold truncate">{speaker.speakerId}</p>
                                {isDominant && (
                                  <Badge variant="outline" className="border-yellow-500 text-yellow-700 bg-yellow-50 text-[9px] px-1 py-0 h-3.5">
                                    <TrendingUp className="h-2 w-2 mr-0.5" />
                                    Dom
                                  </Badge>
                                )}
                                {isSilent && (
                                  <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5">
                                    Silent
                                  </Badge>
                                )}
                              </div>
                              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                                <span>{speaker.totalSegments}s</span>
                                <span>•</span>
                                <span>{Math.round(speaker.totalTalkTime)}s</span>
                              </div>
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="text-sm font-bold leading-none">{speaker.percentage.toFixed(1)}%</p>
                            <p className="text-[9px] text-muted-foreground">talk</p>
                          </div>
                        </div>

                        {totalSpeakerFlags > 0 && (
                          <div className="pt-2 border-t border-border/50">
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-[9px] text-muted-foreground uppercase tracking-wide">Flags</span>
                              <span className={`text-xs font-bold ${
                                speaker.profanityCount > 0 || speaker.languagePolicyCount > 0 
                                  ? 'text-destructive' 
                                  : speaker.offTopicCount > 0 
                                  ? 'text-yellow-600'
                                  : 'text-blue-600'
                              }`}>
                                {totalSpeakerFlags}
                              </span>
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {speaker.profanityCount > 0 && (
                                <Badge variant="destructive" className="text-[9px] px-1 py-0 h-3.5">
                                  <AlertTriangle className="h-2 w-2 mr-0.5" />
                                  {speaker.profanityCount}
                                </Badge>
                              )}
                              {speaker.languagePolicyCount > 0 && (
                                <Badge variant="outline" className="border-orange-500 text-orange-700 bg-orange-50 text-[9px] px-1 py-0 h-3.5">
                                  {speaker.languagePolicyCount}L
                                </Badge>
                              )}
                              {speaker.offTopicCount > 0 && (
                                <Badge variant="outline" className="border-yellow-500 text-yellow-700 bg-yellow-50 text-[9px] px-1 py-0 h-3.5">
                                  {speaker.offTopicCount}O
                                </Badge>
                              )}
                              {speaker.participationFlags > 0 && (
                                <Badge 
                                  variant="outline" 
                                  className="border-blue-500 text-blue-700 bg-blue-50 text-[9px] px-1 py-0 h-3.5"
                                  title={`${speaker.participationFlags} participation ${speaker.participationFlags === 1 ? 'flag' : 'flags'}`}
                                >
                                  {speaker.participationFlags}P
                                </Badge>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                ) : (
                  <div className="text-center py-6 text-muted-foreground text-xs">
                    No speaker data
                  </div>
                )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>

            {/* Right: Main Content Area - Flags and Sessions Side by Side */}
            <div className="flex-1 min-w-0 flex flex-col min-h-0">
              <div className="grid grid-cols-1 xl:grid-cols-[40%,1fr] gap-2 flex-1 min-h-0">
                {/* Left: Flags Section */}
                <Card className="flex flex-col min-h-0">
                  <CardHeader className="flex-shrink-0 pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Flag className="h-4 w-4" />
                      Flags ({filteredFlags.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex-1 overflow-hidden p-3">
                    <ScrollArea className="h-full">
                      {filteredFlags.length > 0 ? (
                        <div className="space-y-1.5">
                          {filteredFlags.map((flag) => {
                            const flagConfig = {
                              profanity: { color: 'destructive', icon: AlertTriangle, label: 'Profanity' },
                              language_policy: { color: 'orange', icon: Languages, label: 'Language' },
                              off_topic: { color: 'yellow', icon: MessageSquareX, label: 'Off-Topic' },
                              participation: { color: 'blue', icon: UserX, label: 'Participation' },
                            }[flag.flagType] || { color: 'gray', icon: Flag, label: 'Flag' };
                            const Icon = flagConfig.icon;
                            
                            return (
                              <div
                                key={flag.id}
                                className={`p-2.5 border rounded-lg hover:bg-muted/30 transition-colors ${
                                  flag.flagType === 'profanity' ? 'border-destructive/30 bg-destructive/5' :
                                  flag.flagType === 'language_policy' ? 'border-orange-500/30 bg-orange-500/5' :
                                  flag.flagType === 'off_topic' ? 'border-yellow-500/30 bg-yellow-500/5' :
                                  flag.flagType === 'participation' ? 'border-blue-500/30 bg-blue-500/5' :
                                  'border-border'
                                }`}
                              >
                                <div className="flex items-start gap-2">
                                  <div className="flex-shrink-0 mt-0.5">
                                    <Icon className={`h-3.5 w-3.5 ${
                                      flag.flagType === 'profanity' ? 'text-destructive' :
                                      flag.flagType === 'language_policy' ? 'text-orange-600' :
                                      flag.flagType === 'off_topic' ? 'text-yellow-600' :
                                      flag.flagType === 'participation' ? 'text-blue-600' :
                                      'text-muted-foreground'
                                    }`} />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap mb-1">
                                      <Badge variant={flag.flagType === 'profanity' ? 'destructive' : 'outline'} className="text-[10px] px-1.5 py-0 h-4">
                                        {flagConfig.label}
                                      </Badge>
                                      <span className="text-xs font-medium truncate">{flag.flaggedWord}</span>
                                      {flag.speaker && (
                                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
                                          {flag.speaker}
                                        </Badge>
                                      )}
                                      <span className="text-[10px] text-muted-foreground ml-auto">
                                        @ {formatTimestamp(flag.timestampMs)}
                                      </span>
                                    </div>
                                    {flag.context && (
                                      <p className="text-xs text-muted-foreground line-clamp-1 mb-1">{flag.context}</p>
                                    )}
                                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                                      <span className="truncate">{flag.transcript.title}</span>
                                      <span>•</span>
                                      <span>{formatDateTime(flag.createdAt)}</span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="text-center py-12">
                          <Flag className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                          <p className="text-xs text-muted-foreground">No flagged content</p>
                        </div>
                      )}
                    </ScrollArea>
                  </CardContent>
                </Card>

                {/* Right: Sessions Section */}
                <Card className="flex flex-col min-h-0">
                  <CardHeader className="flex-shrink-0 pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base flex items-center gap-2">
                        <FileText className="h-4 w-4" />
                        Sessions ({filteredSessions.length})
                      </CardTitle>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2"
                        onClick={() => {
                          queryClient.invalidateQueries({ queryKey: ["/api/dashboard/device", deviceId] });
                          // Force refresh from Soniox
                          queryClient.refetchQueries({ 
                            queryKey: ["/api/dashboard/device", deviceId],
                            queryFn: async () => {
                              const response = await fetch(`/api/dashboard/device/${deviceId}?refreshFromSoniox=true`, {
                                credentials: 'include',
                              });
                              if (!response.ok) throw new Error('Failed to refresh');
                              return response.json();
                            },
                          });
                        }}
                        title="Refresh from Soniox"
                      >
                        <RefreshCw className="h-3 w-3" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="flex-1 overflow-hidden p-2 sm:p-3">
                    <ScrollArea className="h-full pr-1">
                      {filteredSessions.length > 0 ? (
                      <div className="space-y-2 sm:space-y-3 pr-1">
                        {filteredSessions.map((session) => {
                          const segments: TranscriptSegment[] = typeof session.segments === 'string'
                            ? JSON.parse(session.segments)
                            : session.segments || [];
                          const speakers = Array.from(new Set(segments.map((seg: any) => seg.speaker) || []));
                          const isExpanded = expandedSessionId === session.id;
                          
                          // Calculate session metrics
                          const totalTalkTime = segments.reduce((sum, seg) => sum + (seg.endTime - seg.startTime), 0);
                          const durationMinutes = session.duration ? Math.floor(session.duration / 60) : Math.floor(totalTalkTime / 60);
                          const durationSeconds = session.duration ? Math.floor(session.duration % 60) : Math.floor(totalTalkTime % 60);
                          const formattedDuration = durationMinutes > 0 ? `${durationMinutes}m ${durationSeconds}s` : `${durationSeconds}s`;
                          
                          // Parse participation balance
                          // The stored balance can be either:
                          // 1. The full ParticipationBalance object with speakers array, dominantSpeaker, silentSpeakers
                          // 2. A Record mapping speakerId to { talkTime, percentage }
                          const participationBalance = session.participationBalance as any;
                          let participationSpeakers: Array<{ speakerId: string; talkTime: number; percentage: number }> = [];
                          let dominantSpeaker: { speakerId: string; percentage: number } | undefined;
                          let silentSpeakers: Array<{ speakerId: string; percentage: number }> = [];
                          
                          if (participationBalance) {
                            // Check if it's the full ParticipationBalance object
                            if (participationBalance.speakers && Array.isArray(participationBalance.speakers)) {
                              participationSpeakers = participationBalance.speakers.map((s: any) => ({
                                speakerId: s.speakerId,
                                talkTime: s.talkTime || 0,
                                percentage: s.percentage || 0,
                              }));
                              
                              // Use stored dominantSpeaker and silentSpeakers if available
                              if (participationBalance.dominantSpeaker) {
                                const dominant = participationSpeakers.find(s => s.speakerId === participationBalance.dominantSpeaker);
                                if (dominant) {
                                  dominantSpeaker = dominant;
                                }
                              }
                              
                              if (participationBalance.silentSpeakers && Array.isArray(participationBalance.silentSpeakers)) {
                                silentSpeakers = participationBalance.silentSpeakers
                                  .map((speakerId: string) => participationSpeakers.find(s => s.speakerId === speakerId))
                                  .filter((s): s is { speakerId: string; talkTime: number; percentage: number } => s !== undefined);
                              }
                            } else if (typeof participationBalance === 'object') {
                              // Legacy format: Record<string, { talkTime, percentage }>
                              participationSpeakers = Object.entries(participationBalance)
                                .map(([speakerId, data]: [string, any]) => ({ 
                                  speakerId, 
                                  talkTime: data?.talkTime || 0,
                                  percentage: data?.percentage || 0
                                }))
                                .filter(s => s.percentage > 0);
                              
                              // Calculate dynamic thresholds based on number of speakers
                              // Note: percentages in legacy format are stored as decimals (0-1), not percentages (0-100)
                              const numberOfSpeakers = participationSpeakers.length;
                              if (numberOfSpeakers > 0) {
                                const fairShare = 1 / numberOfSpeakers;
                                const dominanceThreshold = Math.min(fairShare * 1.5, 0.6); // 1.5x fair share, max 60% (as decimal)
                                const silenceThreshold = Math.max(fairShare * 0.3, 0.05); // 0.3x fair share, min 5% (as decimal)
                                
                                // Find dominant speaker (only if 2+ speakers)
                                // Compare with decimal thresholds since stored percentages are decimals
                                if (numberOfSpeakers >= 2) {
                                  const dominant = participationSpeakers.find(s => (s.percentage || 0) > dominanceThreshold);
                                  if (dominant) {
                                    dominantSpeaker = dominant;
                                  }
                                }
                                
                                // Find silent speakers (only if 3+ speakers)
                                // Compare with decimal thresholds since stored percentages are decimals
                                if (numberOfSpeakers >= 3) {
                                  silentSpeakers = participationSpeakers.filter(s => (s.percentage || 0) < silenceThreshold && (s.percentage || 0) > 0);
                                }
                              }
                            }
                            
                            // Sort by percentage descending
                            participationSpeakers.sort((a, b) => b.percentage - a.percentage);
                          }
                          
                          // Get flag counts for this session
                          const sessionFlags = filteredFlags.filter(f => f.transcriptId === session.id);
                          const sessionProfanity = sessionFlags.filter(f => f.flagType === 'profanity').length;
                          const sessionLanguage = sessionFlags.filter(f => f.flagType === 'language_policy').length;
                          const sessionOffTopic = sessionFlags.filter(f => f.flagType === 'off_topic').length;
                          const sessionParticipation = sessionFlags.filter(f => f.flagType === 'participation').length;
                          const totalSessionFlags = sessionProfanity + sessionLanguage + sessionOffTopic + sessionParticipation;
                          
                          // Topic adherence
                          const topicAdherence = session.topicAdherenceScore;
                          const hasTopicAdherence = topicAdherence !== null && topicAdherence !== undefined;
                          
                          return (
                            <Card key={session.id} className="overflow-visible">
                              {/* Session Header */}
                              <CardHeader className="pb-2 px-2 sm:px-3">
                                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                                  <div className="flex-1 min-w-0">
                                    <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 mb-1.5">
                                      <h3 className="text-xs sm:text-sm font-semibold truncate">{session.title}</h3>
                                      <div className="flex items-center gap-1 flex-shrink-0 flex-wrap">
                                        <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4">
                                          {session.source === 'live' ? 'Live' : 'Upload'}
                                        </Badge>
                                        <Badge variant={session.status === 'complete' ? 'default' : 'secondary'} className="text-[9px] px-1.5 py-0 h-4">
                                          {session.status === 'complete' ? 'Comp' : 'Draft'}
                                        </Badge>
                                        {session.language && (
                                          <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4">
                                            {session.language.toUpperCase()}
                                          </Badge>
                                        )}
                                      </div>
                                    </div>
                                    
                                    {session.topicPrompt && (
                                      <p className="text-[10px] text-muted-foreground mb-1.5 line-clamp-2 sm:line-clamp-1">
                                        <span className="font-medium">Topic:</span> {session.topicPrompt}
                                      </p>
                                    )}
                                    
                                    <div className="flex items-center gap-1.5 sm:gap-2 text-[9px] sm:text-[10px] text-muted-foreground flex-wrap">
                                      <div className="flex items-center gap-0.5">
                                        <Clock className="h-2.5 w-2.5" />
                                        <span>{formattedDuration}</span>
                                      </div>
                                      <span>•</span>
                                      <div className="flex items-center gap-0.5">
                                        <Users className="h-2.5 w-2.5" />
                                        <span>{speakers.length} {speakers.length === 1 ? 'Sp' : 'Sp'}</span>
                                      </div>
                                      <span>•</span>
                                      <div className="flex items-center gap-0.5">
                                        <FileText className="h-2.5 w-2.5" />
                                        <span>{segments.length} seg</span>
                                      </div>
                                      <span>•</span>
                                      <span className="truncate">{formatDateTime(session.createdAt)}</span>
                                    </div>
                                  </div>
                                  
                                  {segments.length > 0 && (
                                    <div className="flex items-center gap-1.5 flex-shrink-0 sm:self-start">
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setExpandedSessionId(isExpanded ? null : session.id);
                                        }}
                                        className="h-6 text-[9px] sm:text-[10px] px-2 whitespace-nowrap"
                                      >
                                        {isExpanded ? 'Hide' : 'View'} Transcript
                                      </Button>
                                    </div>
                                  )}
                                </div>
                              </CardHeader>

                              {/* Session Metrics Grid */}
                              <CardContent className="pt-0 pb-3 px-3">
                                <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 gap-2 mb-2">
                                  {/* Topic Adherence */}
                                  {hasTopicAdherence && (
                                    <div className="space-y-1.5 min-w-0">
                                      <div className="flex items-center justify-between gap-1">
                                        <div className="flex items-center gap-1.5 min-w-0">
                                          <MessageSquareX className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                                          <p className="text-[10px] text-muted-foreground uppercase tracking-wide truncate">Topic</p>
                                        </div>
                                        <Badge 
                                          variant={topicAdherence >= 0.7 ? 'default' : topicAdherence >= 0.5 ? 'secondary' : 'destructive'}
                                          className="text-[10px] px-1.5 py-0 h-4 flex-shrink-0"
                                        >
                                          {Math.round(topicAdherence * 100)}%
                                        </Badge>
                                      </div>
                                      <div className="w-full bg-muted rounded-full h-1.5">
                                        <div 
                                          className={`h-1.5 rounded-full transition-all ${
                                            topicAdherence >= 0.7 
                                              ? 'bg-green-600' 
                                              : topicAdherence >= 0.5 
                                              ? 'bg-yellow-600' 
                                              : 'bg-red-600'
                                          }`}
                                          style={{ width: `${topicAdherence * 100}%` }}
                                        />
                                      </div>
                                    </div>
                                  )}

                                  {/* Flags Summary */}
                                  <div className="space-y-1.5 min-w-0">
                                    <div className="flex items-center justify-between gap-1">
                                      <div className="flex items-center gap-1.5 min-w-0">
                                        <Flag className={`h-3 w-3 flex-shrink-0 ${totalSessionFlags > 0 ? 'text-destructive' : 'text-muted-foreground'}`} />
                                        <p className="text-[10px] text-muted-foreground uppercase tracking-wide truncate">Flags</p>
                                      </div>
                                      <p className={`text-xs font-bold flex-shrink-0 ${totalSessionFlags > 0 ? 'text-destructive' : ''}`}>
                                        {totalSessionFlags}
                                      </p>
                                    </div>
                                    {totalSessionFlags > 0 && (
                                      <div className="flex flex-wrap gap-1">
                                        {sessionProfanity > 0 && (
                                          <Badge variant="destructive" className="text-[9px] px-1 py-0 h-3.5">
                                            {sessionProfanity}P
                                          </Badge>
                                        )}
                                        {sessionLanguage > 0 && (
                                          <Badge variant="outline" className="border-orange-500 text-orange-700 bg-orange-50 text-[9px] px-1 py-0 h-3.5">
                                            {sessionLanguage}L
                                          </Badge>
                                        )}
                                        {sessionOffTopic > 0 && (
                                          <Badge variant="outline" className="border-yellow-500 text-yellow-700 bg-yellow-50 text-[9px] px-1 py-0 h-3.5">
                                            {sessionOffTopic}O
                                          </Badge>
                                        )}
                                        {sessionParticipation > 0 && (
                                          <Badge 
                                            variant="outline" 
                                            className="border-blue-500 text-blue-700 bg-blue-50 text-[9px] px-1 py-0 h-3.5"
                                            title={`${sessionParticipation} participation ${sessionParticipation === 1 ? 'flag' : 'flags'} (dominance/silence issues)`}
                                          >
                                            {sessionParticipation}P
                                          </Badge>
                                        )}
                                      </div>
                                    )}
                                  </div>

                                  {/* Participation Balance */}
                                  {participationSpeakers.length > 0 && (
                                    <div className="space-y-1.5 min-w-0">
                                      <div className="flex items-center justify-between gap-1">
                                        <div className="flex items-center gap-1.5 min-w-0">
                                          <BarChart3 className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                                          <p className="text-[10px] text-muted-foreground uppercase tracking-wide truncate">Balance</p>
                                        </div>
                                        {dominantSpeaker && (
                                          <Badge variant="outline" className="border-yellow-500 text-yellow-700 bg-yellow-50 text-[9px] px-1.5 py-0 h-4 flex-shrink-0">
                                            <TrendingUp className="h-2 w-2 mr-0.5" />
                                            Imbalanced
                                          </Badge>
                                        )}
                                        {!dominantSpeaker && silentSpeakers.length === 0 && (
                                          <Badge variant="default" className="text-[9px] px-1.5 py-0 h-4 flex-shrink-0">
                                            Balanced
                                          </Badge>
                                        )}
                                      </div>
                                      {participationSpeakers.length > 0 && (
                                        <div className="flex gap-0.5">
                                          {participationSpeakers.slice(0, 4).map((sp) => {
                                            const color = getSpeakerColor(sp.speakerId);
                                            // Percentage is stored as decimal (0-1), convert to 0-100 for display
                                            const percentage = (sp.percentage || 0) * 100;
                                            return (
                                              <div
                                                key={sp.speakerId}
                                                className="flex-1 h-1.5 rounded"
                                                style={{ 
                                                  backgroundColor: color,
                                                  opacity: Math.min(percentage / 100, 1)
                                                }}
                                                title={`${sp.speakerId}: ${percentage.toFixed(1)}%`}
                                              />
                                            );
                                          })}
                                        </div>
                                      )}
                                    </div>
                                  )}

                                  {/* Talk Time */}
                                  <div className="space-y-1.5 min-w-0">
                                    <div className="flex items-center justify-between gap-1">
                                      <div className="flex items-center gap-1.5 min-w-0">
                                        <Activity className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                                        <p className="text-[10px] text-muted-foreground uppercase tracking-wide truncate">Talk Time</p>
                                      </div>
                                      <p className="text-xs font-bold flex-shrink-0">
                                        {Math.round(totalTalkTime / 60)}m
                                      </p>
                                    </div>
                                    <p className="text-[10px] text-muted-foreground">
                                      {Math.round(totalTalkTime)}s total
                                    </p>
                                  </div>
                                </div>

                                {/* Participation Breakdown */}
                                {participationSpeakers.length > 0 && (
                                  <div className="pt-3 border-t">
                                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-2">Participation</p>
                                    <div className="flex items-center gap-2 flex-wrap">
                                      {participationSpeakers.slice(0, 4).map((sp) => {
                                        const color = getSpeakerColor(sp.speakerId);
                                        // Percentage is stored as decimal (0-1), convert to 0-100 for display
                                        const percentage = (sp.percentage || 0) * 100;
                                        return (
                                          <div key={sp.speakerId} className="flex items-center gap-1.5">
                                            <div
                                              className="w-2 h-2 rounded-full flex-shrink-0"
                                              style={{ backgroundColor: color }}
                                            />
                                            <span className="text-xs font-medium truncate max-w-[60px]">{sp.speakerId}</span>
                                            <span className="text-xs font-bold">{percentage.toFixed(0)}%</span>
                                          </div>
                                        );
                                      })}
                                      {participationSpeakers.length > 4 && (
                                        <span className="text-xs text-muted-foreground">
                                          +{participationSpeakers.length - 4} more
                                        </span>
                                      )}
                                      {dominantSpeaker && (
                                        <Badge variant="outline" className="border-yellow-500 text-yellow-700 bg-yellow-50 text-[9px] px-1.5 py-0 h-4 ml-auto">
                                          <TrendingUp className="h-2 w-2 mr-0.5" />
                                          {dominantSpeaker.speakerId} dominant ({((dominantSpeaker.percentage || 0) * 100).toFixed(0)}%)
                                        </Badge>
                                      )}
                                      {silentSpeakers.length > 0 && (
                                        <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4">
                                          <TrendingDown className="h-2 w-2 mr-0.5" />
                                          {silentSpeakers.length} silent
                                        </Badge>
                                      )}
                                    </div>
                                  </div>
                                )}

                                {/* Transcript Preview - Full Transcript Display */}
                                {isExpanded && segments.length > 0 && (
                                  <>
                                    <Separator className="my-3" />
                                    <div className="w-full">
                                      <div className="flex items-center justify-between mb-3">
                                        <h4 className="text-sm font-semibold">Full Transcript</h4>
                                        <div className="flex items-center gap-2">
                                          <Badge variant="secondary" className="text-xs px-2 py-0.5 h-5">{segments.length} segments</Badge>
                                          {segments.some(s => hasProfanity(s.text)) && (
                                            <Button
                                              variant="destructive"
                                              size="sm"
                                              className="text-xs h-5 px-2"
                                              onClick={async () => {
                                                try {
                                                  // Quick report: create flags for all profanity in this transcript
                                                  const profanitySegments = segments.filter(s => hasProfanity(s.text));
                                                  const response = await fetch(`/api/transcripts/${session.id}/quick-report`, {
                                                    method: 'POST',
                                                    credentials: 'include',
                                                    headers: { 'Content-Type': 'application/json' },
                                                    body: JSON.stringify({
                                                      segments: profanitySegments.map(s => ({
                                                        text: s.text,
                                                        startTime: s.startTime,
                                                        endTime: s.endTime,
                                                        speaker: s.speaker,
                                                      })),
                                                    }),
                                                  });
                                                  if (response.ok) {
                                                    toast({
                                                      title: 'Reported',
                                                      description: `Reported ${profanitySegments.length} profanity instance(s)`,
                                                    });
                                                    // Refetch to update flags
                                                    queryClient.invalidateQueries({ queryKey: ['/api/flagged-content'] });
                                                  }
                                                } catch (error) {
                                                  console.error('Failed to report:', error);
                                                }
                                              }}
                                            >
                                              <Flag className="h-3 w-3 mr-1" />
                                              Quick Report
                                            </Button>
                                          )}
                                        </div>
                                      </div>
                                      <div className="border rounded-md bg-muted/30 overflow-hidden">
                                        <ScrollArea className="h-[400px] sm:h-[500px] md:h-[600px] lg:h-[700px] w-full">
                                          <div className="p-4 space-y-2">
                                            {segments.map((segment, idx) => (
                                              <div key={`${session.id}-segment-${idx}`} className="w-full">
                                                <TranscriptSegmentComponent
                                                  segment={segment}
                                                  speakerColor={getSpeakerColor(segment.speaker)}
                                                />
                                              </div>
                                            ))}
                                          </div>
                                        </ScrollArea>
                                      </div>
                                    </div>
                                  </>
                                )}
                              </CardContent>
                            </Card>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="text-center py-12">
                        <FileText className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                        <p className="text-xs text-muted-foreground">No sessions found</p>
                      </div>
                    )}
                    </ScrollArea>
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </>
      ) : (
        <Card className="m-4">
          <CardContent className="text-center py-12">
            <p className="text-muted-foreground">Device not found</p>
          </CardContent>
        </Card>
      )}
      </div>
    </div>
  );
}

