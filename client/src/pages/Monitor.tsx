import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertTriangle, Users, MessageSquareWarning, ShieldAlert, Languages, MessageSquareX, UserX } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useLocation } from 'wouter';

type AlertType = 'PROFANITY_ALERT' | 'LANGUAGE_POLICY_ALERT' | 'TOPIC_ADHERENCE_ALERT' | 'PARTICIPATION_ALERT';

interface Alert {
  type: AlertType;
  deviceId: string;
  deviceName: string;
  transcriptId: string;
  flaggedWord: string;
  timestampMs: number;
  speaker: string;
  context: string;
  flagType?: 'profanity' | 'language_policy' | 'off_topic' | 'participation';
  timestamp: string; // Added by frontend
}

interface DashboardStats {
  devices: Array<{
    id: string;
    name: string;
    totalSessions: number;
    totalProfanity: number;
  }>;
  totalDevices: number;
  totalSessions: number;
  totalProfanity: number;
}

export default function Monitor() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const getAlertConfig = (alertType: AlertType | string) => {
    switch (alertType) {
      case 'PROFANITY_ALERT':
        return {
          title: 'Profanity Detected',
          icon: AlertTriangle,
          color: 'destructive',
          badgeColor: 'destructive',
          borderColor: 'border-destructive/50',
          bgColor: 'bg-destructive/5',
        };
      case 'LANGUAGE_POLICY_ALERT':
        return {
          title: 'Language Policy Violation',
          icon: Languages,
          color: 'orange',
          badgeColor: 'outline',
          borderColor: 'border-orange-500/50',
          bgColor: 'bg-orange-500/5',
        };
      case 'TOPIC_ADHERENCE_ALERT':
        return {
          title: 'Off-Topic Content',
          icon: MessageSquareX,
          color: 'yellow',
          badgeColor: 'outline',
          borderColor: 'border-yellow-500/50',
          bgColor: 'bg-yellow-500/5',
        };
      case 'PARTICIPATION_ALERT':
        return {
          title: 'Participation Imbalance',
          icon: UserX,
          color: 'blue',
          badgeColor: 'outline',
          borderColor: 'border-blue-500/50',
          bgColor: 'bg-blue-500/5',
        };
      default:
        return {
          title: 'Alert',
          icon: AlertTriangle,
          color: 'destructive',
          badgeColor: 'destructive',
          borderColor: 'border-destructive/50',
          bgColor: 'bg-destructive/5',
        };
    }
  };

  // Fetch dashboard stats with error handling
  const { data: stats, isLoading: statsLoading, isError, error } = useQuery<DashboardStats>({
    queryKey: ['/api/dashboard/stats'],
    retry: false,
  });

  // WebSocket connection for real-time alerts
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/monitor`);

    ws.onopen = () => {
      console.log('[Monitor] WebSocket connected');
      setIsConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.type === 'CONNECTED') {
          console.log('[Monitor] Connected:', data.message);
          return;
        }

        // Handle all alert types
        if (['PROFANITY_ALERT', 'LANGUAGE_POLICY_ALERT', 'TOPIC_ADHERENCE_ALERT', 'PARTICIPATION_ALERT'].includes(data.type)) {
          const alert: Alert = {
            ...data,
            timestamp: new Date().toISOString(),
          };
          
          setAlerts((prev) => [alert, ...prev].slice(0, 50)); // Keep last 50 alerts

          // Show toast notification with appropriate styling
          const config = getAlertConfig(data.type);
          const Icon = config.icon;
          
          toast({
            title: config.title,
            description: `${data.deviceName} - "${data.flaggedWord}" by ${data.speaker}`,
            variant: config.color === 'destructive' ? 'destructive' : 'default',
          });
        }
      } catch (error) {
        console.error('[Monitor] Parse error:', error);
      }
    };

    ws.onclose = (event) => {
      console.log('[Monitor] WebSocket closed:', event.code, event.reason);
      setIsConnected(false);
    };

    ws.onerror = (error) => {
      console.error('[Monitor] WebSocket error:', error);
      setIsConnected(false);
    };

    return () => {
      ws.close();
    };
  }, [toast]);

  const formatTimestamp = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  if (statsLoading) {
    return (
      <div className="flex items-center justify-center h-full" data-testid="loading-monitor">
        <div className="text-center">
          <div className="text-lg" data-testid="text-loading-message">Loading dashboard...</div>
        </div>
      </div>
    );
  }

  // Handle authorization errors
  if (isError) {
    const errorResponse = error as any;
    // React Query wraps errors - check response.status for HTTP errors
    const status = errorResponse?.response?.status || errorResponse?.status;
    const isUnauthorized = status === 401 || status === 403;

    return (
      <div className="flex items-center justify-center h-full p-8" data-testid="error-monitor">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2" data-testid="text-error-title">
              <ShieldAlert className="h-5 w-5 text-destructive" />
              Access Denied
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Alert variant="destructive" data-testid="alert-unauthorized">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle data-testid="text-alert-title">
                {isUnauthorized ? 'Admin Access Required' : 'Error Loading Dashboard'}
              </AlertTitle>
              <AlertDescription data-testid="text-alert-description">
                {isUnauthorized
                  ? 'You do not have permission to access the admin monitoring dashboard. Please contact your administrator or login with an admin account.'
                  : 'Failed to load dashboard data. Please try again later.'}
              </AlertDescription>
            </Alert>
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => setLocation('/dashboard')}
                className="text-sm text-primary hover:underline"
                data-testid="button-back-to-dashboard"
              >
                ← Back to Dashboard
              </button>
              <button
                onClick={() => window.location.href = '/api/logout'}
                className="text-sm text-muted-foreground hover:underline ml-auto"
                data-testid="button-logout"
              >
                Logout
              </button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden" data-testid="page-monitor">
      {/* Header */}
      <div className="border-b p-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold" data-testid="text-monitor-title">
              Admin Monitoring Dashboard
            </h1>
            <p className="text-sm text-muted-foreground" data-testid="text-monitor-subtitle">
              Real-time content monitoring across all devices
            </p>
          </div>
          <Badge
            variant={isConnected ? 'default' : 'destructive'}
            data-testid={`badge-connection-${isConnected ? 'connected' : 'disconnected'}`}
          >
            {isConnected ? 'Connected' : 'Disconnected'}
          </Badge>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4">
        <Card data-testid="card-total-devices">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Devices</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-devices">
              {stats?.totalDevices || 0}
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-total-sessions">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Sessions</CardTitle>
            <MessageSquareWarning className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-sessions">
              {stats?.totalSessions || 0}
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-total-profanity">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Flags</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-profanity">
              {stats?.totalProfanity || 0}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              All flagged content
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main Content: Device List and Alert Feed */}
      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4 p-4 overflow-hidden">
        {/* Device List */}
        <Card className="flex flex-col overflow-hidden" data-testid="card-device-list">
          <CardHeader>
            <CardTitle>Devices</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 overflow-hidden">
            <ScrollArea className="h-full">
              <div className="space-y-2">
                {stats?.devices && stats.devices.length > 0 ? (
                  stats.devices.map((device) => (
                    <div
                      key={device.id}
                      className="flex items-center justify-between p-3 border rounded-md hover-elevate"
                      data-testid={`device-item-${device.id}`}
                    >
                      <div>
                        <div className="font-medium" data-testid={`text-device-name-${device.id}`}>
                          {device.name}
                        </div>
                        <div className="text-sm text-muted-foreground" data-testid={`text-device-sessions-${device.id}`}>
                          {device.totalSessions} sessions
                        </div>
                      </div>
                      <Badge
                        variant={device.totalProfanity > 0 ? 'destructive' : 'secondary'}
                        data-testid={`badge-profanity-${device.id}`}
                      >
                        {device.totalProfanity} flags
                      </Badge>
                    </div>
                  ))
                ) : (
                  <div className="text-center text-muted-foreground py-8" data-testid="text-no-devices">
                    No devices found
                  </div>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Alert Feed */}
        <Card className="flex flex-col overflow-hidden" data-testid="card-alert-feed">
          <CardHeader>
            <CardTitle>Live Alert Feed</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 overflow-hidden">
            <ScrollArea className="h-full">
              <div className="space-y-2">
                {alerts.length > 0 ? (
                  alerts.map((alert, index) => {
                    const config = getAlertConfig(alert.type);
                    const Icon = config.icon;
                    
                    return (
                      <div
                        key={`${alert.transcriptId}-${alert.timestampMs}-${index}`}
                        className={`p-3 border rounded-md ${config.borderColor} ${config.bgColor}`}
                        data-testid={`alert-item-${index}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <Icon 
                                className={`h-4 w-4 flex-shrink-0 ${
                                  config.color === 'destructive' ? 'text-destructive' :
                                  config.color === 'orange' ? 'text-orange-600' :
                                  config.color === 'yellow' ? 'text-yellow-600' :
                                  'text-blue-600'
                                }`}
                              />
                              <Badge 
                                variant={config.badgeColor as any}
                                className={
                                  config.color === 'orange' ? 'border-orange-500 text-orange-700 bg-orange-50' :
                                  config.color === 'yellow' ? 'border-yellow-500 text-yellow-700 bg-yellow-50' :
                                  config.color === 'blue' ? 'border-blue-500 text-blue-700 bg-blue-50' :
                                  ''
                                }
                                data-testid={`badge-alert-type-${index}`}
                              >
                                {config.title}
                              </Badge>
                              <span className="font-medium truncate" data-testid={`text-alert-device-${index}`}>
                                {alert.deviceName}
                              </span>
                            </div>
                            <div className="text-sm space-y-1">
                              <div>
                                <span className="text-muted-foreground">Speaker: </span>
                                <span data-testid={`text-alert-speaker-${index}`}>{alert.speaker}</span>
                                <span className="text-muted-foreground"> at </span>
                                <span data-testid={`text-alert-timestamp-${index}`}>
                                  {formatTimestamp(alert.timestampMs)}
                                </span>
                              </div>
                              <div>
                                <span className="text-muted-foreground">
                                  {alert.flagType === 'participation' ? 'Issue: ' : 'Word: '}
                                </span>
                                <span 
                                  className={`font-semibold ${
                                    config.color === 'destructive' ? 'text-destructive' :
                                    config.color === 'orange' ? 'text-orange-600' :
                                    config.color === 'yellow' ? 'text-yellow-600' :
                                    'text-blue-600'
                                  }`}
                                  data-testid={`text-alert-word-${index}`}
                                >
                                  "{alert.flaggedWord}"
                                </span>
                              </div>
                              {alert.context && (
                                <div className="text-xs text-muted-foreground italic" data-testid={`text-alert-context-${index}`}>
                                  ...{alert.context}...
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="text-xs text-muted-foreground whitespace-nowrap" data-testid={`text-alert-createdAt-${index}`}>
                            {new Date(alert.timestamp).toLocaleTimeString()}
                          </div>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="text-center text-muted-foreground py-8" data-testid="text-no-alerts">
                    {isConnected ? 'No alerts yet. Monitoring...' : 'Disconnected from alert feed'}
                  </div>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
