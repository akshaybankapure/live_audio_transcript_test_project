// Simple in-memory TTL cache suitable for single-instance deployments
// Not shared across multiple server instances. For multi-instance, use Redis.
type CacheEntry<T> = {
	value: T;
	expiresAt: number;
};

class TtlCache {
	private store = new Map<string, CacheEntry<any>>();
	private defaultTtlMs: number;
	private maxEntries: number;

	constructor(options?: { defaultTtlMs?: number; maxEntries?: number }) {
		this.defaultTtlMs = options?.defaultTtlMs ?? 60_000; // 60s
		this.maxEntries = options?.maxEntries ?? 1000;
	}

	get<T>(key: string): T | undefined {
		const entry = this.store.get(key);
		if (!entry) return undefined;
		if (Date.now() > entry.expiresAt) {
			this.store.delete(key);
			return undefined;
		}
		return entry.value as T;
	}

	set<T>(key: string, value: T, ttlMs?: number): void {
		// Basic LRU-ish control: evict oldest when exceeding maxEntries
		if (this.store.size >= this.maxEntries) {
			// delete first inserted key
			const firstKey = this.store.keys().next().value;
			if (firstKey) this.store.delete(firstKey);
		}
		this.store.set(key, {
			value,
			expiresAt: Date.now() + (ttlMs ?? this.defaultTtlMs),
		});
	}

	invalidate(key: string): void {
		this.store.delete(key);
	}

	invalidatePrefix(prefix: string): void {
		for (const key of this.store.keys()) {
			if (key.startsWith(prefix)) {
				this.store.delete(key);
			}
		}
	}
}

export const serverCache = new TtlCache({
	defaultTtlMs: 60_000, // 60s default
	maxEntries: 2000,
});

export function buildUserScopedKey(userId: string, path: string, query?: any): string {
	const q = typeof query === 'string' ? query : query ? JSON.stringify(query) : '';
	return `user:${userId}|path:${path}|q:${q}`;
}

export function setPrivateCacheHeaders(res: import('express').Response, maxAgeSeconds = 60, staleWhileRevalidateSeconds = 120) {
	res.set({
		'Cache-Control': `private, max-age=${maxAgeSeconds}, stale-while-revalidate=${staleWhileRevalidateSeconds}`,
	});
}


