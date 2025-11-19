import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { 
  Users, 
  Flag, 
  FileText, 
  AlertTriangle, 
  CheckCircle2, 
  Loader2,
  Languages,
  MessageSquareX,
  UserX,
  Clock,
  Activity,
  Calendar,
  Filter,
  Eye,
  Target
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { getQueryFn } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface DeviceOverview {
  userId: string;
  displayName: string | null;
  sessionCount: number;
  flagCount: number;
  flagBreakdown?: {
    profanity: number;
    languagePolicy: number;
    offTopic: number;
    participation: number;
  };
  avgTopicAdherence: number | null;
  lastActivity: string | null;
}

interface DashboardOverviewResponse {
  devices: DeviceOverview[];
  currentUserId: string;
}

interface Alert {
  type: 'PROFANITY_ALERT' | 'LANGUAGE_POLICY_ALERT' | 'TOPIC_ADHERENCE_ALERT' | 'PARTICIPATION_ALERT';
  deviceId: string;
  deviceName: string;
  transcriptId: string;
  flaggedWord: string;
  timestampMs: number;
  speaker: string;
  context: string;
  flagType?: 'profanity' | 'language_policy' | 'off_topic' | 'participation';
  timestamp: string;
}

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [acknowledgedAlerts, setAcknowledgedAlerts] = useState<Set<string>>(new Set());
  
  // Filter state - default to 'live'
  const [timeRange, setTimeRange] = useState<'live' | 'all' | 'custom' | 'session' | '1h' | '12h' | 'today'>('live');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [transcriptId, setTranscriptId] = useState<string>('');
  const [appliedDateRange, setAppliedDateRange] = useState<{ start: string; end: string } | null>(null);

  // Get user to check if they can see alerts
  const { data: user } = useQuery({
    queryKey: ['/api/auth/user'],
    retry: false,
    // Tolerate unauthenticated state without throwing; returns null
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  // Fetch available transcripts for session selector
  const { data: transcriptsData } = useQuery({
    queryKey: ['/api/transcripts'],
    retry: false,
    enabled: timeRange === 'session',
  });

  // Build query parameters based on filter state
  const queryParams = new URLSearchParams();
  queryParams.set('timeRange', timeRange);
  if (timeRange === 'custom' && appliedDateRange) {
    queryParams.set('startDate', appliedDateRange.start);
    queryParams.set('endDate', appliedDateRange.end);
  } else if (timeRange === 'session' && transcriptId) {
    queryParams.set('transcriptId', transcriptId);
  }

  // Use cached data immediately - only refetch if stale
  const { data, isLoading, isFetching } = useQuery<DashboardOverviewResponse>({
    queryKey: [`/api/dashboard/overview?${queryParams.toString()}`],
    placeholderData: (previousData) => previousData,
    refetchOnMount: true, // Refetch on mount to get latest data
    staleTime: 10 * 1000, // 10 seconds - data stays fresh for short time
    refetchInterval: 30 * 1000, // Refetch every 30 seconds for live updates
    // Only fetch once we know the auth state; prevents initial 401 error path
    enabled: user !== undefined && user !== null,
  });

  // WebSocket connection for real-time alerts (all authenticated users)
  useEffect(() => {
    if (!user) {
      setIsConnected(false);
      return; // Only connect if authenticated
    }

    // Small delay to ensure session cookie is available after authentication
    let ws: WebSocket | null = null;
    const connectTimeout = setTimeout(() => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${protocol}//${window.location.host}/ws/monitor`);

      ws.onopen = () => {
        console.log('[Dashboard] WebSocket connected');
        setIsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'CONNECTED') {
            console.log('[Dashboard] Connected:', data.message);
            return;
          }

          // Handle all alert types
          if (['PROFANITY_ALERT', 'LANGUAGE_POLICY_ALERT', 'TOPIC_ADHERENCE_ALERT', 'PARTICIPATION_ALERT'].includes(data.type)) {
            const alert: Alert = {
              ...data,
              timestamp: new Date().toISOString(),
            };
            
            setAlerts((prev) => [alert, ...prev].slice(0, 100)); // Keep last 100 alerts

            // Invalidate and refetch dashboard overview to update device stats in real-time
            // This makes the dashboard truly live and actionable
            queryClient.invalidateQueries({
              queryKey: ['/api/dashboard/overview'],
            });

            // Show toast notification for high-priority alerts only
            if (data.type === 'PROFANITY_ALERT' || data.type === 'LANGUAGE_POLICY_ALERT') {
              toast({
                title: data.type === 'PROFANITY_ALERT' ? 'Profanity Detected' : 'Language Policy Violation',
                description: `${data.deviceName} - "${data.flaggedWord}" by ${data.speaker}`,
                variant: 'destructive',
                action: {
                  altText: 'View device',
                  onClick: () => setLocation(`/dashboard/device/${data.deviceId}`),
                },
              });
            }
          }
        } catch (error) {
          console.error('[Dashboard] Parse error:', error);
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        // Reconnect after 3 seconds if connection lost
        setTimeout(() => {
          if (user) {
            // Will reconnect via useEffect
          }
        }, 3000);
      };

      ws.onerror = (error) => {
        console.error('[Dashboard] WebSocket error:', error);
        setIsConnected(false);
      };
    }, 100); // Small delay to ensure cookies are available

    return () => {
      clearTimeout(connectTimeout);
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        ws.close();
      }
    };
  }, [user, toast, queryClient, setLocation]);

  const formatDate = (dateString: string | null | Date) => {
    if (!dateString) return 'Never';
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const formatTimeAgo = (timestamp: string) => {
    const now = new Date();
    const alertTime = new Date(timestamp);
    const seconds = Math.floor((now.getTime() - alertTime.getTime()) / 1000);
    
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  };

  const getAlertConfig = (alertType: string) => {
    switch (alertType) {
      case 'PROFANITY_ALERT':
        return {
          title: 'Profanity',
          icon: AlertTriangle,
          color: 'text-destructive',
          bgColor: 'bg-destructive/10',
          borderColor: 'border-destructive/50',
        };
      case 'LANGUAGE_POLICY_ALERT':
        return {
          title: 'Language',
          icon: Languages,
          color: 'text-orange-600',
          bgColor: 'bg-orange-500/10',
          borderColor: 'border-orange-500/50',
        };
      case 'TOPIC_ADHERENCE_ALERT':
        return {
          title: 'Off-Topic',
          icon: MessageSquareX,
          color: 'text-yellow-600',
          bgColor: 'bg-yellow-500/10',
          borderColor: 'border-yellow-500/50',
        };
      case 'PARTICIPATION_ALERT':
        return {
          title: 'Participation',
          icon: UserX,
          color: 'text-blue-600',
          bgColor: 'bg-blue-500/10',
          borderColor: 'border-blue-500/50',
        };
      default:
        return {
          title: 'Alert',
          icon: AlertTriangle,
          color: 'text-muted-foreground',
          bgColor: 'bg-muted/50',
          borderColor: 'border-border',
        };
    }
  };

  const totalDevices = data?.devices.length || 0;
  const totalSessions = data?.devices.reduce((sum, d) => sum + d.sessionCount, 0) || 0;
  const totalFlags = data?.devices.reduce((sum, d) => sum + d.flagCount, 0) || 0;
  const activeDevices = data?.devices.filter(d => d.sessionCount > 0).length || 0;

  // Show UI immediately - use cached data if available, show skeletons only if no cache
  const hasData = data !== undefined;
  const showLoading = isLoading && !hasData;

  return (
    <div className="h-screen flex flex-col overflow-hidden" data-testid="page-dashboard">
      {/* Header */}
      <div className="flex-shrink-0 px-4 py-3 border-b bg-background">
        <div className="flex items-center justify-between">
      <div>
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-dashboard-title">Dashboard</h1>
            <p className="text-sm text-muted-foreground mt-0.5" data-testid="text-dashboard-subtitle">
              Overview of all devices and groups
            </p>
          </div>
          {isFetching && hasData && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>Updating...</span>
            </div>
          )}
        </div>
        
        {/* Filter Tabs */}
        <div className="mt-3">
          <Tabs value={timeRange} onValueChange={(v) => {
            setTimeRange(v as 'live' | 'all' | 'custom' | 'session' | '1h' | '12h' | 'today');
            // Reset filters when switching modes
            if (v !== 'custom') {
              setStartDate('');
              setEndDate('');
              setAppliedDateRange(null);
            }
            if (v !== 'session') {
              setTranscriptId('');
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
                <Calendar className="h-3 w-3 mr-1" />
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
                <Calendar className="h-3 w-3 mr-1" />
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
                  <Label htmlFor="start-date" className="text-xs text-muted-foreground mb-1.5 block">
                    Start Date
                  </Label>
                  <Input
                    id="start-date"
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="h-9 text-xs"
                  />
                </div>
                <div className="flex-1">
                  <Label htmlFor="end-date" className="text-xs text-muted-foreground mb-1.5 block">
                    End Date
                  </Label>
                  <Input
                    id="end-date"
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="h-9 text-xs"
                    min={startDate}
                  />
                </div>
                <Button
                  size="sm"
                  onClick={() => {
                    if (startDate && endDate) {
                      setAppliedDateRange({ start: startDate, end: endDate });
                      // Query will automatically refetch when appliedDateRange changes
                    } else {
                      toast({
                        title: "Missing dates",
                        description: "Please select both start and end dates",
                        variant: "destructive",
                      });
                    }
                  }}
                  disabled={!startDate || !endDate}
                  className="h-9 text-xs"
                >
                  <Filter className="h-3 w-3 mr-1.5" />
                  Apply
                </Button>
              </div>
            </TabsContent>
            
            <TabsContent value="session" className="mt-3">
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <Label htmlFor="session-select" className="text-xs text-muted-foreground mb-1.5 block">
                    Select Session
                  </Label>
                  <Select value={transcriptId} onValueChange={setTranscriptId}>
                    <SelectTrigger id="session-select" className="h-9 text-xs">
                      <SelectValue placeholder="Choose a session..." />
                    </SelectTrigger>
                    <SelectContent>
                      {transcriptsData && Array.isArray(transcriptsData) && transcriptsData.length > 0 ? (
                        transcriptsData.map((transcript: any) => (
                          <SelectItem key={transcript.id} value={transcript.id} className="text-xs">
                            <div className="flex flex-col">
                              <span className="font-medium">{transcript.title}</span>
                              <span className="text-xs text-muted-foreground">
                                {new Date(transcript.createdAt).toLocaleString()}
                              </span>
                            </div>
                          </SelectItem>
                        ))
                      ) : (
                        <SelectItem value="none" disabled>
                          No sessions available
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setTranscriptId('')}
                  disabled={!transcriptId}
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
      <div className="flex-1 overflow-hidden flex gap-4 p-4">
        {/* Left: Main Content Area */}
        <div className="flex-1 flex flex-col overflow-hidden space-y-3 min-w-0">
          {/* Compact Stats Row */}
          <div className="grid grid-cols-4 gap-2">
            <Card className="p-3" data-testid="card-stat-devices">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <p className="text-xs text-muted-foreground font-medium">Devices</p>
                  {showLoading ? (
                    <Skeleton className="h-6 w-12" />
            ) : (
                    <p className="text-xl font-bold" data-testid="text-total-devices">{totalDevices}</p>
            )}
                  <p className="text-[10px] text-muted-foreground">{activeDevices} active</p>
                </div>
                <Users className="h-4 w-4 text-muted-foreground" />
              </div>
        </Card>

            <Card className="p-3" data-testid="card-stat-sessions">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <p className="text-xs text-muted-foreground font-medium">Sessions</p>
                  {showLoading ? (
                    <Skeleton className="h-6 w-12" />
            ) : (
                    <p className="text-xl font-bold" data-testid="text-total-sessions">{totalSessions}</p>
            )}
                  <p className="text-[10px] text-muted-foreground">All time</p>
                </div>
                <FileText className="h-4 w-4 text-muted-foreground" />
              </div>
        </Card>

            <Card className="p-3" data-testid="card-stat-flags">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <p className="text-xs text-muted-foreground font-medium">Flags</p>
                  {showLoading ? (
                    <Skeleton className="h-6 w-12" />
            ) : (
                    <p className={`text-xl font-bold ${totalFlags > 0 ? 'text-destructive' : ''}`} data-testid="text-total-flags">{totalFlags}</p>
            )}
                  <p className="text-[10px] text-muted-foreground">Total alerts</p>
                </div>
                <Flag className="h-4 w-4 text-muted-foreground" />
              </div>
        </Card>

            <Card className="p-3" data-testid="card-stat-active">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <p className="text-xs text-muted-foreground font-medium">Active</p>
                  {showLoading ? (
                    <Skeleton className="h-6 w-12" />
            ) : (
                    <p className="text-xl font-bold" data-testid="text-active-devices">{activeDevices}</p>
            )}
                  <p className="text-[10px] text-muted-foreground">With recordings</p>
                </div>
                <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
              </div>
        </Card>
      </div>

          {/* Devices & Groups - Grid */}
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold" data-testid="text-devices-header">
          Devices & Groups
        </h2>
              {data && data.devices.length > 0 && (
                <span className="text-xs text-muted-foreground">{data.devices.length} total</span>
              )}
            </div>
            
            <ScrollArea className="flex-1 border rounded-md">
              <div className="p-3">
                {showLoading ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {[1, 2, 3, 4, 5, 6].map(i => (
                      <Skeleton key={i} className="h-32 w-full" />
            ))}
          </div>
        ) : data && data.devices.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {data.devices.map((device) => {
              const isCurrentUser = device.userId === data.currentUserId;
                      const isActive = device.sessionCount > 0;
                      const hasFlags = device.flagCount > 0;
                      
                      // Get recent alerts for this device
                      const deviceAlerts = alerts.filter(a => a.deviceId === device.userId).slice(0, 2);
                      
                      // Determine if critical (profanity, high language flags, or low topic adherence)
                      const isCritical = (device.flagBreakdown?.profanity || 0) > 0 || 
                                        (device.flagBreakdown?.languagePolicy || 0) > 2 || 
                                        (device.avgTopicAdherence !== null && device.avgTopicAdherence < 0.7);
                      
                      // Calculate time since last activity
                      const timeSinceActivity = device.lastActivity 
                        ? Date.now() - new Date(device.lastActivity).getTime()
                        : Infinity;
                      const activityText = timeSinceActivity < 60000 
                        ? 'Just now' 
                        : timeSinceActivity < 3600000 
                        ? `${Math.floor(timeSinceActivity / 60000)}m ago`
                        : formatDate(device.lastActivity);
              
              return (
                <Card
                  key={device.userId}
                          className={`p-5 cursor-pointer transition-all hover:shadow-lg ${
                            isCritical ? 'border-red-300 border-2' : ''
                          }`}
                  onClick={() => setLocation(`/dashboard/device/${device.userId}`)}
                  data-testid={`card-device-${device.userId}`}
                >
                          {/* Group Header - Matching Figma */}
                          <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-3">
                              <div className={`size-10 rounded-full flex items-center justify-center ${
                                isActive ? 'bg-green-100' : 'bg-gray-100'
                              }`}>
                                <Users className={`size-5 ${
                                  isActive ? 'text-green-600' : 'text-gray-400'
                                }`} />
                              </div>
                              <div>
                                <h3 className="text-base font-semibold" data-testid={`text-device-name-${device.userId}`}>
                                  {device.displayName || 'Unknown Device'}
                                </h3>
                                <p className="text-xs text-muted-foreground">
                                  {device.sessionCount > 0 ? `${device.sessionCount} ${device.sessionCount === 1 ? 'session' : 'sessions'}` : 'No sessions'}
                                </p>
                              </div>
                            </div>
                            <div className="text-right">
                              <Badge variant={isActive ? "default" : "outline"} className="mb-1">
                                {isActive ? 'Live' : 'Paused'}
                              </Badge>
                              <div className="text-xs text-muted-foreground" data-testid={`text-device-activity-${device.userId}`}>
                                {device.lastActivity ? activityText : 'Never active'}
                              </div>
                            </div>
                          </div>

                          {/* Critical Alerts - "Needs Attention" Box */}
                          {isCritical && (
                            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                              <div className="flex items-center gap-2 text-red-700 mb-2">
                                <AlertTriangle className="size-4" />
                                <span className="text-sm font-semibold">Needs Attention</span>
                              </div>
                              {deviceAlerts.length > 0 ? (
                                deviceAlerts.map((alert, idx) => (
                                  <div key={idx} className="text-xs text-red-600 mb-1">
                                    • {alert.type === 'PROFANITY_ALERT' 
                                      ? `Inappropriate language from ${alert.speaker}`
                                      : alert.type === 'LANGUAGE_POLICY_ALERT'
                                      ? `${alert.flaggedWord} detected from ${alert.speaker}`
                                      : alert.context || alert.flaggedWord}
                                  </div>
                                ))
                              ) : (
                                <>
                                  {(device.flagBreakdown?.profanity || 0) > 0 && (
                                    <div className="text-xs text-red-600 mb-1">
                                      • Inappropriate language detected
                                    </div>
                                  )}
                                  {(device.flagBreakdown?.languagePolicy || 0) > 0 && (
                                    <div className="text-xs text-red-600 mb-1">
                                      • Non-English language detected
                                    </div>
                                  )}
                                  {device.avgTopicAdherence !== null && device.avgTopicAdherence < 0.7 && (
                                    <div className="text-xs text-red-600 mb-1">
                                      • Discussion drifting off-topic
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                          )}

                          {/* Metrics */}
                          <div className="space-y-3 mb-4">
                            {/* Topic Adherence */}
                            {device.avgTopicAdherence !== null && device.sessionCount > 0 && (
                              <div>
                                <div className="flex items-center justify-between text-xs mb-1">
                                  <div className="flex items-center gap-1">
                                    <Target className="size-3" />
                                    <span>Topic Adherence</span>
                                  </div>
                                  <span className={
                                    device.avgTopicAdherence > 0.8 ? 'text-green-600' :
                                    device.avgTopicAdherence > 0.7 ? 'text-orange-600' :
                                    'text-red-600'
                                  }>
                                    {Math.round(device.avgTopicAdherence * 100)}%
                                  </span>
                                </div>
                                <Progress 
                                  value={device.avgTopicAdherence * 100} 
                                  className="h-2"
                                />
                              </div>
                            )}

                            {/* Participation */}
                            <div className="flex items-center justify-between text-xs">
                              <div className="flex items-center gap-1">
                                <Users className="size-3" />
                                <span>Participation</span>
                              </div>
                              <Badge 
                                variant={device.flagBreakdown?.participation === 0 ? "default" : "destructive"}
                                className="text-xs"
                              >
                                {device.flagBreakdown?.participation === 0 ? 'Balanced' : 'Imbalanced'}
                              </Badge>
                            </div>

                            {/* Flag Breakdown - 2x2 Grid with Colored Backgrounds */}
                            <div className="grid grid-cols-2 gap-2 text-xs">
                              <div className="flex items-center justify-between p-2 bg-red-50 rounded">
                                <span>Profanity</span>
                                <Badge variant={device.flagBreakdown?.profanity ? "destructive" : "outline"} className="text-xs">
                                  {device.flagBreakdown?.profanity || 0}
                                </Badge>
                              </div>
                              <div className="flex items-center justify-between p-2 bg-orange-50 rounded">
                                <span>Language</span>
                                <Badge variant={device.flagBreakdown?.languagePolicy ? "destructive" : "outline"} className="text-xs">
                                  {device.flagBreakdown?.languagePolicy || 0}
                                </Badge>
                              </div>
                              <div className="flex items-center justify-between p-2 bg-yellow-50 rounded">
                                <span>Participation</span>
                                <Badge variant="outline" className="text-xs">
                                  {device.flagBreakdown?.participation || 0}
                                </Badge>
                              </div>
                              <div className="flex items-center justify-between p-2 bg-blue-50 rounded">
                                <span>Off-topic</span>
                                <Badge variant="outline" className="text-xs">
                                  {device.flagBreakdown?.offTopic || 0}
                                </Badge>
                              </div>
                            </div>
                          </div>

                          {/* View Details Button */}
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="w-full"
                            onClick={(e) => {
                              e.stopPropagation();
                              setLocation(`/dashboard/device/${device.userId}`);
                            }}
                          >
                            <Eye className="size-4 mr-2" />
                            View Details
                          </Button>
                </Card>
              );
            })}
          </div>
        ) : (
          <Card>
            <CardContent className="text-center py-12">
                      <Users className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                      <p className="text-sm font-medium text-muted-foreground">No devices found</p>
                      <p className="text-xs text-muted-foreground mt-1">
                Start recording to create your first session
              </p>
            </CardContent>
          </Card>
        )}
      </div>
            </ScrollArea>
          </div>
        </div>

        {/* Right: Recent Alerts Sidebar */}
        <div className="w-80 flex-shrink-0 flex flex-col border rounded-md bg-background">
          <div className="flex-shrink-0 p-3 border-b">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Live Alerts</h3>
              <div className="flex items-center gap-2">
                {isConnected ? (
                  <div className="flex items-center gap-1.5">
                    <div className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
                    <span className="text-[10px] text-muted-foreground">Live</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <div className="h-1.5 w-1.5 rounded-full bg-muted" />
                    <span className="text-[10px] text-muted-foreground">Offline</span>
                  </div>
                )}
                {alerts.filter(a => !acknowledgedAlerts.has(`${a.deviceId}-${a.timestampMs}-${alerts.indexOf(a)}`)).length > 0 && (
                  <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-4">
                    {alerts.filter(a => !acknowledgedAlerts.has(`${a.deviceId}-${a.timestampMs}-${alerts.indexOf(a)}`)).length}
                  </Badge>
                )}
              </div>
            </div>
            {alerts.length > 0 && (
              <div className="mt-2 flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[10px] px-2"
                  onClick={() => {
                    const allAlertIds = alerts.map((a, idx) => `${a.deviceId}-${a.timestampMs}-${idx}`);
                    setAcknowledgedAlerts(new Set(allAlertIds));
                  }}
                >
                  Dismiss All
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[10px] px-2"
                  onClick={() => setAcknowledgedAlerts(new Set())}
                >
                  Show All
                </Button>
              </div>
            )}
          </div>

          <ScrollArea className="flex-1">
            <div className="p-2 space-y-2">
              {alerts.length === 0 ? (
                <div className="text-center py-8 px-4">
                  <Activity className="h-8 w-8 mx-auto text-muted-foreground mb-2 opacity-50" />
                  <p className="text-xs text-muted-foreground">No alerts yet</p>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Alerts from live sessions will appear here
                  </p>
                </div>
              ) : (
                alerts.map((alert, index) => {
                  const alertId = `${alert.deviceId}-${alert.timestampMs}-${index}`;
                  const isAcknowledged = acknowledgedAlerts.has(alertId);
                  
                  // Skip acknowledged alerts
                  if (isAcknowledged) return null;
                  
                  const config = getAlertConfig(alert.type);
                  const Icon = config.icon;
                  
                  return (
                    <Card
                      key={alertId}
                      className={`p-2.5 transition-all hover:shadow-sm border-l-2 ${config.borderColor} ${config.bgColor} ${
                        isAcknowledged ? 'opacity-60' : 'cursor-pointer'
                      }`}
                      onClick={() => {
                        if (!isAcknowledged) {
                          setLocation(`/dashboard/device/${alert.deviceId}`);
                        }
                      }}
                    >
                      <div className="space-y-1.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0 flex-1">
                            <Icon className={`h-3.5 w-3.5 flex-shrink-0 mt-0.5 ${config.color}`} />
                            <Badge variant={alert.type === 'PROFANITY_ALERT' ? 'destructive' : 'secondary'} className="text-[10px] px-1.5 py-0 h-4">
                              {config.title}
                            </Badge>
                            {!isAcknowledged && (
                              <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse flex-shrink-0" />
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                              {formatTimeAgo(alert.timestamp)}
                            </span>
                            {!isAcknowledged && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-5 w-5 p-0 hover:bg-muted"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setAcknowledgedAlerts((prev) => new Set(prev).add(alertId));
                                }}
                                title="Dismiss alert"
                              >
                                <span className="text-[10px]">×</span>
                              </Button>
                            )}
                          </div>
                        </div>
                        
                        <div>
                          <p className="text-xs font-semibold truncate">{alert.deviceName}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {alert.speaker} • {new Date(alert.timestampMs).toLocaleTimeString('en-US', { 
                              hour: '2-digit', 
                              minute: '2-digit', 
                              second: '2-digit' 
                            })}
                          </p>
                        </div>
                        
                        {alert.context && (
                          <div className="mt-1">
                            <p className="text-[11px] text-muted-foreground line-clamp-2">
                              "{alert.context}"
                            </p>
                          </div>
                        )}
                        
                        {alert.flaggedWord && (
                          <div className="flex items-center gap-1 mt-1">
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 font-mono">
                              {alert.flaggedWord}
                            </Badge>
                          </div>
                        )}
                      </div>
                    </Card>
                  );
                })
              )}
            </div>
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}
