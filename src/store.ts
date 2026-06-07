import { RateLimiterStore, RateLimiterEntry } from './types';

/**
 * In-memory store implementation for rate limiting.
 * Suitable for single-instance deployments or development.
 * For distributed deployments, use a custom store backed by Redis or similar.
 */
export class InMemoryStore implements RateLimiterStore {
  private store = new Map<string, RateLimiterEntry>();
  private cleanupInterval: NodeJS.Timeout;
  private readonly maxAge: number;

  constructor(maxAgeMs: number = 60_000) {
    this.maxAge = maxAgeMs;
    // Periodically clean up old entries
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, Math.max(5000, maxAgeMs / 2));
    this.cleanupInterval.unref();
  }

  async increment(key: string, timestamp: number): Promise<RateLimiterEntry> {
    let entry = this.store.get(key);

    if (!entry) {
      entry = {
        count: 1,
        firstRequestAt: timestamp,
        lastRequestAt: timestamp,
      };
    } else {
      entry.count += 1;
      entry.lastRequestAt = timestamp;
    }

    this.store.set(key, entry);
    return { ...entry };
  }

  async get(key: string): Promise<RateLimiterEntry | null> {
    const entry = this.store.get(key);
    return entry ? { ...entry } : null;
  }

  async reset(key: string): Promise<void> {
    this.store.delete(key);
  }

  private cleanup(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, entry] of this.store.entries()) {
      if (now - entry.lastRequestAt > this.maxAge) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.store.delete(key);
    }
  }

  /**
   * Destroy the store and clear cleanup interval
   */
  destroy(): void {
    clearInterval(this.cleanupInterval);
    this.store.clear();
  }

  /**
   * Get current number of tracked clients
   */
  size(): number {
    return this.store.size;
  }
}
