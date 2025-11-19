import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { persistQueryClient } from "./persistQueryClient";

const API_BASE_URL = import.meta.env.VITE_API_URL || "";

function getFullUrl(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  return `${API_BASE_URL}${path}`;
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(getFullUrl(url), {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(getFullUrl(queryKey.join("/") as string), {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

// Create query client with aggressive caching for fast load times
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      // Aggressive caching: data is fresh for 30 minutes
      staleTime: 30 * 60 * 1000, // 30 minutes - data stays fresh longer
      // Keep cached data for 2 hours even when unused (persists across reloads)
      gcTime: 2 * 60 * 60 * 1000, // 2 hours (formerly cacheTime)
      retry: false,
      // Only refetch if data is actually stale (not on every mount)
      refetchOnMount: false, // Changed from true - use cached data if fresh
      // Use placeholder data for instant UI rendering
      placeholderData: (previousData) => previousData,
      // Network mode: prefer cached data, only fetch if stale
      networkMode: 'online',
    },
    mutations: {
      retry: false,
    },
  },
});

// Enable localStorage persistence for instant reloads
if (typeof window !== 'undefined') {
  // Initialize persistence (this also restores cache)
  const cleanup = persistQueryClient(queryClient);
  
  // Persist cache before page unload
  window.addEventListener('beforeunload', () => {
    // Force immediate persistence
    const queries = queryClient.getQueryCache().getAll();
    const cacheEntries = queries
      .filter((q) => q.state.status === 'success' && q.state.data !== undefined)
      .map((q) => ({
        queryKey: q.queryKey,
        data: q.state.data,
        dataUpdatedAt: q.state.dataUpdatedAt || Date.now(),
        status: q.state.status,
      }));
    
    try {
      localStorage.setItem('react-query-cache-v1', JSON.stringify({
        entries: cacheEntries,
        timestamp: Date.now(),
      }));
    } catch (e) {
      // Ignore storage errors on unload
    }
  });
  
  // Cleanup on hot module reload (development)
  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      cleanup();
    });
  }
}
