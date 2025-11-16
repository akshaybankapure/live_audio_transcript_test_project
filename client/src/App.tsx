import { Suspense, lazy, useEffect } from "react";
import { Switch, Route, Link, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { LayoutDashboard, Mic, LogIn, LogOut, User, Shield, Loader2 } from "lucide-react";
import { authenticateDevice } from "./lib/deviceAuth";
import { Skeleton } from "@/components/ui/skeleton";

// Import Home page directly (most common route) for faster initial load
import Home from "@/pages/Home";
// Lazy load other pages for code splitting
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const DeviceDetails = lazy(() => import("@/pages/DeviceDetails"));
const Monitor = lazy(() => import("@/pages/Monitor"));
const NotFound = lazy(() => import("@/pages/not-found"));

type User = {
  id: string;
  email?: string;
  displayName?: string;
  firstName?: string;
  lastName?: string;
  profileImageUrl?: string;
  role?: 'user' | 'admin';
};

function Navigation() {
  const [location] = useLocation();
  const queryClient = useQueryClient();
  
  const { data: user, isLoading, refetch } = useQuery<User | null>({
    queryKey: ['/api/auth/user'],
    retry: false,
    queryFn: async () => {
      const res = await fetch('/api/auth/user', {
        credentials: 'include',
      });
      if (res.status === 401) {
        return null;
      }
      if (!res.ok) {
        throw new Error(`Failed to fetch user: ${res.statusText}`);
      }
      return await res.json() as User | null;
    },
  });

  // Prefetch dashboard data when user hovers over dashboard link or when authenticated
  useEffect(() => {
    if (user) {
      // Prefetch dashboard data immediately after auth
      queryClient.prefetchQuery({
        queryKey: ['/api/dashboard/overview'],
      });
      // Prefetch other frequently used data
      queryClient.prefetchQuery({
        queryKey: ['/api/transcripts'],
      });
      queryClient.prefetchQuery({
        queryKey: ['/api/flagged-content'],
      });
    }
  }, [user, queryClient]);
  
  // Auto-authenticate device on mount (development only)
  useEffect(() => {
    if (import.meta.env.DEV && !user && !isLoading) {
      authenticateDevice()
        .then(() => {
          console.log('[DeviceAuth] Device authenticated, refetching user');
          refetch();
        })
        .catch((error) => {
          console.error('[DeviceAuth] Failed to authenticate device:', error);
        });
    }
  }, [user, isLoading, refetch]);
  
  const handleLogin = async () => {
    if (import.meta.env.DEV) {
      // Development: Use device auth
      try {
        await authenticateDevice();
        refetch();
      } catch (error) {
        console.error('[DeviceAuth] Login failed:', error);
      }
    } else {
      // Production: Use device auth
      try {
        await authenticateDevice();
        refetch();
      } catch (error) {
        console.error('[DeviceAuth] Login failed:', error);
      }
    }
  };

  const handleAdminLogin = async () => {
    try {
      const response = await fetch('/api/auth/admin', {
        method: 'POST',
        credentials: 'include',
      });
      
      if (response.ok) {
        console.log('[AdminAuth] Admin login successful');
        refetch();
      } else {
        console.error('[AdminAuth] Admin login failed:', await response.text());
      }
    } catch (error) {
      console.error('[AdminAuth] Admin login error:', error);
    }
  };
  
  const handleLogout = () => {
    window.location.href = '/api/logout';
  };
  
  const displayName = user?.displayName || user?.firstName || user?.email || 'User';
  
  return (
    <nav className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Mic className="h-6 w-6" />
            <h1 className="text-xl font-bold" data-testid="text-app-title">Audio Transcript Viewer</h1>
          </div>
          
          <div className="flex gap-2 items-center">
            <Link href="/">
              <Button 
                variant={location === "/" ? "default" : "ghost"}
                className="gap-2"
                data-testid="button-nav-home"
              >
                <Mic className="h-4 w-4" />
                Transcribe
              </Button>
            </Link>
            <Link href="/dashboard">
              <Button 
                variant={location === "/dashboard" ? "default" : "ghost"}
                className="gap-2"
                data-testid="button-nav-dashboard"
                onMouseEnter={() => {
                  // Prefetch dashboard data on hover
                  queryClient.prefetchQuery({
                    queryKey: ['/api/dashboard/overview'],
                  });
                }}
              >
                <LayoutDashboard className="h-4 w-4" />
                Dashboard
              </Button>
            </Link>
            
            {user?.role === 'admin' && (
              <Link href="/monitor">
                <Button 
                  variant={location === "/monitor" ? "default" : "ghost"}
                  className="gap-2"
                  data-testid="button-nav-monitor"
                >
                  <Shield className="h-4 w-4" />
                  Monitor
                </Button>
              </Link>
            )}
            
            <div className="ml-4 border-l pl-4 flex items-center gap-2">
              {isLoading ? (
                <Skeleton className="h-9 w-20" />
              ) : !user ? (
                <>
                  <Button 
                    onClick={handleLogin}
                    variant="default"
                    className="gap-2"
                    data-testid="button-login"
                  >
                    <LogIn className="h-4 w-4" />
                    Login
                  </Button>
                  {import.meta.env.DEV && (
                    <Button 
                      onClick={handleAdminLogin}
                      variant="outline"
                      size="sm"
                      className="gap-2"
                      data-testid="button-admin-login"
                    >
                      <Shield className="h-3 w-3" />
                      Admin
                    </Button>
                  )}
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2" data-testid="user-profile">
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={user.profileImageUrl} alt={displayName} />
                      <AvatarFallback>
                        <User className="h-4 w-4" />
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-sm font-medium" data-testid="text-username">{displayName}</span>
                  </div>
                  <Button 
                    onClick={handleLogout}
                    variant="ghost"
                    size="sm"
                    className="gap-2"
                    data-testid="button-logout"
                  >
                    <LogOut className="h-4 w-4" />
                    Logout
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}

function LoadingFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    </div>
  );
}

function Router() {
  const queryClient = useQueryClient();
  const [location] = useLocation();

  // Prefetch route components on mount for faster navigation
  useEffect(() => {
    // Prefetch all route components in background
    Promise.all([
      import("@/pages/Dashboard"),
      import("@/pages/DeviceDetails"),
      import("@/pages/Monitor"),
      import("@/pages/not-found"),
    ]).catch(() => {
      // Ignore errors - prefetching is best effort
    });
  }, []);

  // Prefetch dashboard data when on home page (likely next navigation)
  useEffect(() => {
    if (location === "/") {
      queryClient.prefetchQuery({
        queryKey: ['/api/dashboard/overview'],
      });
    }
  }, [location, queryClient]);

  return (
    <div className="min-h-screen flex flex-col">
      <Navigation />
      <main className="flex-1">
        <Suspense fallback={<LoadingFallback />}>
          <Switch>
            <Route path="/" component={Home} />
            <Route path="/dashboard" component={Dashboard} />
            <Route path="/dashboard/device/:deviceId" component={DeviceDetails} />
            <Route path="/monitor" component={Monitor} />
            <Route component={NotFound} />
          </Switch>
        </Suspense>
      </main>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={0}>
        <Suspense fallback={null}>
          <Toaster />
        </Suspense>
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
