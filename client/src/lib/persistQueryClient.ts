import { QueryClient } from '@tanstack/react-query';

const CACHE_KEY = 'react-query-cache-v1';
const MAX_CACHE_AGE = 2 * 60 * 60 * 1000; // 2 hours

interface CacheEntry {
  queryKey: unknown[];
  data: unknown;
  dataUpdatedAt: number;
  status: string;
}

// Simple localStorage adapter for React Query persistence
function persistToStorage(client: QueryClient) {
  try {
    const queries = client.getQueryCache().getAll();
    const cacheEntries: CacheEntry[] = queries
      .filter((query) => {
        // Only cache successful queries with data
        return query.state.status === 'success' && query.state.data !== undefined;
      })
      .map((query) => ({
        queryKey: query.queryKey,
        data: query.state.data,
        dataUpdatedAt: query.state.dataUpdatedAt || Date.now(),
        status: query.state.status,
      }));

    const serialized = JSON.stringify({
      entries: cacheEntries,
      timestamp: Date.now(),
    });
    
    localStorage.setItem(CACHE_KEY, serialized);
  } catch (error) {
    // Handle quota exceeded or other storage errors gracefully
    if (error instanceof Error && error.name === 'QuotaExceededError') {
      console.warn('[Cache] localStorage quota exceeded, clearing old cache');
      try {
        // Clear old cache and try again with just recent entries
        const queries = client.getQueryCache().getAll();
        const recentEntries = queries
          .filter((q) => q.state.status === 'success' && q.state.data !== undefined)
          .slice(-50) // Keep only last 50 queries
          .map((query) => ({
            queryKey: query.queryKey,
            data: query.state.data,
            dataUpdatedAt: query.state.dataUpdatedAt || Date.now(),
            status: query.state.status,
          }));
        
        localStorage.setItem(CACHE_KEY, JSON.stringify({
          entries: recentEntries,
          timestamp: Date.now(),
        }));
      } catch (e) {
        console.warn('[Cache] Failed to persist cache:', e);
      }
    } else {
      console.warn('[Cache] Failed to persist to localStorage:', error);
    }
  }
}

function restoreFromStorage(client: QueryClient) {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (!cached) return;

    const parsed = JSON.parse(cached) as { entries: CacheEntry[]; timestamp: number };
    
    // Check if cache is too old
    const cacheAge = Date.now() - parsed.timestamp;
    if (cacheAge > MAX_CACHE_AGE) {
      localStorage.removeItem(CACHE_KEY);
      return;
    }

    // Restore cached queries
    if (parsed.entries && Array.isArray(parsed.entries)) {
      parsed.entries.forEach((entry) => {
        if (entry.queryKey && entry.data !== undefined) {
          try {
            client.setQueryData(entry.queryKey, entry.data, {
              updatedAt: entry.dataUpdatedAt,
            });
          } catch (error) {
            // Ignore individual query restoration errors
            console.warn('[Cache] Failed to restore query:', entry.queryKey, error);
          }
        }
      });
    }
  } catch (error) {
    console.warn('[Cache] Failed to restore from localStorage:', error);
    // Clear corrupted cache
    try {
      localStorage.removeItem(CACHE_KEY);
    } catch (e) {
      // Ignore
    }
  }
}

// Manual persistence function for React Query
let persistTimeout: ReturnType<typeof setTimeout> | null = null;

export function persistQueryClient(client: QueryClient) {
  // Restore cache immediately on initialization
  restoreFromStorage(client);

  // Persist on every query state change (debounced)
  const unsubscribe = client.getQueryCache().subscribe(() => {
    if (persistTimeout) {
      clearTimeout(persistTimeout);
    }
    // Debounce persistence to avoid excessive writes
    persistTimeout = setTimeout(() => {
      persistToStorage(client);
    }, 1000); // Persist after 1 second of inactivity
  });

  // Also persist on visibility change (when user switches tabs)
  const handleVisibilityChange = () => {
    if (!document.hidden) {
      persistToStorage(client);
    }
  };
  
  document.addEventListener('visibilitychange', handleVisibilityChange);

  // Cleanup function
  return () => {
    unsubscribe();
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    if (persistTimeout) {
      clearTimeout(persistTimeout);
    }
  };
}

