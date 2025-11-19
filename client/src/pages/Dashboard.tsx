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
  ArrowLeft,
  Circle,
  Eye,
  Target,
  TrendingUp
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
  const [filterCritical, setFilterCritical] = useState(false);
  
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
    refetchOnMount: false, // Use cached data if available - don't refetch on every mount
    staleTime: 30 * 60 * 1000, // 30 minutes - data stays fresh
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
  
  // Calculate flag breakdowns
  const totalLanguageFlags = data?.devices.reduce((sum, d) => sum + (d.flagBreakdown?.languagePolicy || 0), 0) || 0;
  const totalProfanityFlags = data?.devices.reduce((sum, d) => sum + (d.flagBreakdown?.profanity || 0), 0) || 0;
  
  // Critical groups: profanity > 0, language > 2, or topic adherence < 70
  const criticalGroups = data?.devices.filter(d => 
    (d.flagBreakdown?.profanity || 0) > 0 || 
    (d.flagBreakdown?.languagePolicy || 0) > 2 || 
    (d.avgTopicAdherence !== null && d.avgTopicAdherence < 0.7)
  ) || [];
  
  const displayGroups = filterCritical ? criticalGroups : (data?.devices || []);

  // Show UI immediately - use cached data if available, show skeletons only if no cache
  const hasData = data !== undefined;
  const showLoading = isLoading && !hasData;
  
  const formatTimeAgo = (dateString: string | null) => {
    if (!dateString) return 'Never';
    const now = new Date();
    const date = new Date(dateString);
    const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
    
    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  };

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-gray-50" data-testid="page-dashboard">
      {/* Header */}
      <header className="bg-white border-b px-6 py-4 flex-shrink-0">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => setLocation('/')}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Exit
            </Button>
            <div>
              <h1 className="text-2xl font-bold tracking-tight" data-testid="text-dashboard-title">Teacher Dashboard</h1>
              <p className="text-sm text-gray-500 mt-0.5" data-testid="text-dashboard-subtitle">
                Monitor all group discussions
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="gap-2">
              <Circle className="h-2 w-2 fill-green-500 text-green-500" />
              {activeDevices} Active
            </Badge>
          </div>
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-5 gap-4">
          <Card className="p-4">
            <div className="text-sm text-gray-500 mb-1">Total Groups</div>
            {showLoading ? (
              <Skeleton className="h-8 w-12" />
            ) : (
              <div className="text-2xl font-bold">{totalDevices}</div>
            )}
          </Card>
          <Card className="p-4 border-red-200 bg-red-50">
            <div className="text-sm text-red-700 mb-1">Critical Alerts</div>
            {showLoading ? (
              <Skeleton className="h-8 w-12" />
            ) : (
              <div className="text-2xl font-bold text-red-600">{criticalGroups.length}</div>
            )}
          </Card>
          <Card className="p-4">
            <div className="text-sm text-gray-500 mb-1">Total Flags</div>
            {showLoading ? (
              <Skeleton className="h-8 w-12" />
            ) : (
              <div className="text-2xl font-bold text-orange-600">{totalFlags}</div>
            )}
          </Card>
          <Card className="p-4">
            <div className="text-sm text-gray-500 mb-1">Language Flags</div>
            {showLoading ? (
              <Skeleton className="h-8 w-12" />
            ) : (
              <div className="text-2xl font-bold text-purple-600">{totalLanguageFlags}</div>
            )}
          </Card>
          <Card className="p-4">
            <div className="text-sm text-gray-500 mb-1">Profanity Flags</div>
            {showLoading ? (
              <Skeleton className="h-8 w-12" />
            ) : (
              <div className="text-2xl font-bold text-red-600">{totalProfanityFlags}</div>
            )}
          </Card>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 mt-4">
          <Button
            variant={filterCritical ? "default" : "outline"}
            size="sm"
            onClick={() => setFilterCritical(!filterCritical)}
          >
            <Filter className="h-4 w-4 mr-2" />
            {filterCritical ? 'Show All' : 'Show Critical Only'}
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <ScrollArea className="flex-1">
        <div className="p-6">
          {showLoading ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
              {[1, 2, 3, 4, 5, 6].map(i => (
                <Skeleton key={i} className="h-64 w-full" />
              ))}
            </div>
          ) : displayGroups.length > 0 ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
              {displayGroups.map((device) => {
                const isActive = device.sessionCount > 0;
                const isCritical = (device.flagBreakdown?.profanity || 0) > 0 || 
                                  (device.flagBreakdown?.languagePolicy || 0) > 2 || 
                                  (device.avgTopicAdherence !== null && device.avgTopicAdherence < 0.7);
                const topicAdherencePercent = device.avgTopicAdherence !== null 
                  ? Math.round(device.avgTopicAdherence * 100) 
                  : null;
                const participationBalanced = !device.flagBreakdown?.participation || device.flagBreakdown.participation === 0;
                
                // Get recent flags for critical alerts
                const recentFlags = alerts
                  .filter(a => a.deviceId === device.userId)
                  .slice(0, 2)
                  .map(a => ({
                    type: a.flagType || 'unknown',
                    message: a.flagType === 'language_policy' 
                      ? `Non-English detected from ${a.speaker}`
                      : a.flagType === 'profanity'
                      ? `Inappropriate language from ${a.speaker}`
                      : a.context || 'Alert',
                    timestamp: new Date(a.timestampMs)
                  }));
                
                return (
                  <Card 
                    key={device.userId} 
                    className={`p-5 hover:shadow-lg transition-shadow ${
                      isCritical ? 'border-red-300 border-2' : ''
                    }`}
                    data-testid={`card-device-${device.userId}`}
                  >
                    {/* Group Header */}
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className={`h-10 w-10 rounded-full ${
                          isActive ? 'bg-green-100' : 'bg-gray-100'
                        } flex items-center justify-center`}>
                          <Users className={`h-5 w-5 ${
                            isActive ? 'text-green-600' : 'text-gray-400'
                          }`} />
                        </div>
                        <div>
                          <h3 className="text-lg font-semibold" data-testid={`text-device-name-${device.userId}`}>
                            {device.displayName || 'Unknown Device'}
                          </h3>
                          <p className="text-xs text-gray-500">
                            {device.sessionCount > 0 ? `${device.sessionCount} students` : 'No students'}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <Badge variant={isActive ? "default" : "outline"} className="mb-1">
                          {isActive ? 'Live' : 'Paused'}
                        </Badge>
                        <div className="text-xs text-gray-400">
                          {formatTimeAgo(device.lastActivity)}
                        </div>
                      </div>
                    </div>

                    {/* Critical Alerts */}
                    {isCritical && (
                      <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                        <div className="flex items-center gap-2 text-red-700 mb-2">
                          <AlertTriangle className="h-4 w-4" />
                          <span className="text-sm font-medium">Needs Attention</span>
                        </div>
                        {recentFlags.length > 0 ? (
                          recentFlags.map((flag, idx) => (
                            <div key={idx} className="text-xs text-red-600 mb-1">
                              • {flag.message}
                            </div>
                          ))
                        ) : (
                          <>
                            {(device.flagBreakdown?.profanity || 0) > 0 && (
                              <div className="text-xs text-red-600 mb-1">
                                • Inappropriate language detected
                              </div>
                            )}
                            {(device.flagBreakdown?.languagePolicy || 0) > 2 && (
                              <div className="text-xs text-red-600 mb-1">
                                • Language policy violations detected
                              </div>
                            )}
                            {topicAdherencePercent !== null && topicAdherencePercent < 70 && (
                              <div className="text-xs text-red-600 mb-1">
                                • Low topic adherence
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}

                    {/* Metrics */}
                    <div className="space-y-3 mb-4">
                      {/* Topic Adherence */}
                      {topicAdherencePercent !== null && (
                        <div>
                          <div className="flex items-center justify-between text-xs mb-1">
                            <div className="flex items-center gap-1">
                              <Target className="h-3 w-3" />
                              <span>Topic Adherence</span>
                            </div>
                            <span className={
                              topicAdherencePercent > 80 ? 'text-green-600' :
                              topicAdherencePercent > 70 ? 'text-orange-600' :
                              'text-red-600'
                            }>
                              {topicAdherencePercent}%
                            </span>
                          </div>
                          <Progress value={topicAdherencePercent} className="h-2" />
                        </div>
                      )}

                      {/* Participation */}
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1">
                          <TrendingUp className="h-3 w-3" />
                          <span>Participation</span>
                        </div>
                        <Badge 
                          variant={participationBalanced ? "default" : "destructive"}
                          className="text-xs"
                        >
                          {participationBalanced ? 'Balanced' : 'Imbalanced'}
                        </Badge>
                      </div>

                      {/* Flag Breakdown */}
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="flex items-center justify-between p-2 bg-red-50 rounded">
                          <span>Profanity</span>
                          <Badge variant={(device.flagBreakdown?.profanity || 0) > 0 ? "destructive" : "outline"} className="text-xs">
                            {device.flagBreakdown?.profanity || 0}
                          </Badge>
                        </div>
                        <div className="flex items-center justify-between p-2 bg-purple-50 rounded">
                          <span>Language</span>
                          <Badge variant={(device.flagBreakdown?.languagePolicy || 0) > 2 ? "destructive" : "outline"} className="text-xs">
                            {device.flagBreakdown?.languagePolicy || 0}
                          </Badge>
                        </div>
                        <div className="flex items-center justify-between p-2 bg-orange-50 rounded">
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
                      onClick={() => setLocation(`/dashboard/device/${device.userId}`)}
                    >
                      <Eye className="h-4 w-4 mr-2" />
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
                <p className="text-sm font-medium text-muted-foreground">No groups found</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Start recording to create your first session
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
