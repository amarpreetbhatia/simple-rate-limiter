import { Request, Response, RequestHandler } from 'express';
import {
  RateLimiterAlgorithm,
  RateLimiterConfig,
  RateLimiterEntry,
  RateLimiterHeadersConfig,
  RateLimiterLogger,
  RateLimiterStore,
  RateLimitInfo,
  SlidingWindowEntry,
  TokenBucketEntry,
} from './types';
import { InMemoryStore } from './store';

/**
 * Default logger that wraps console methods.
 */
const createDefaultLogger = (): RateLimiterLogger => ({
  log: (...args: any[]) => console.log(...args),
  warn: (...args: any[]) => console.warn(...args),
  error: (...args: any[]) => console.error(...args),
});

/**
 * Create an Express rate limiter middleware.
 */
export function createRateLimiter(config: RateLimiterConfig): RequestHandler {
  const {
    algorithm = 'sliding-window',
    windowMs,
    maxRequests,
    tokenBucket,
    keyGenerator = defaultKeyGenerator,
    skip,
    onLimitReached,
    onBlocked,
    headers: headersConfig = false,
    store = new InMemoryStore(windowMs),
    metrics,
    logger = createDefaultLogger(),
  } = config;

  const headersEnabled =
    typeof headersConfig === 'boolean' ? headersConfig : headersConfig.enabled;
  const retryAfterHeader =
    typeof headersConfig === 'object' ? headersConfig.retryAfterHeader !== false : true;
  const customHeaders =
    typeof headersConfig === 'object' ? headersConfig.customHeaders : undefined;
  const bucketSize = tokenBucket?.bucketSize ?? maxRequests;
  const refillRate = tokenBucket?.refillRate ?? (maxRequests * 1000) / windowMs;

  const limitReachedClients = new Set<string>();

  return async (req: Request, res: Response, next: Function) => {
    try {
      if (skip && skip(req)) {
        return next();
      }

      const key = keyGenerator(req);
      const now = Date.now();
      const entry = await store.get(key);

      let info: RateLimitInfo;
      let isBlocked = false;

      if (algorithm === 'token-bucket') {
        const { bucketEntry, allowed } = createOrUpdateTokenBucketEntry(
          entry,
          now,
          bucketSize,
          refillRate
        );

        await store.set(key, bucketEntry);

        const remainingRequests = Math.max(0, Math.floor(bucketEntry.tokens));
        const resetInMs = allowed
          ? 0
          : Math.ceil((1 - bucketEntry.tokens) / refillRate * 1000);
        const currentRequests = bucketSize - remainingRequests;

        info = {
          key,
          windowMs,
          maxRequests: bucketSize,
          currentRequests,
          remainingRequests,
          resetInMs,
        };

        if (!allowed) {
          isBlocked = true;
        }
      } else {
        const windowEntry = createOrUpdateSlidingWindowEntry(entry, now, windowMs);
        await store.set(key, windowEntry);

        const currentRequests = windowEntry.timestamps.length;
        const remainingRequests = Math.max(0, maxRequests - currentRequests);
        const resetInMs = currentRequests === 0
          ? windowMs
          : Math.max(0, windowMs - (now - windowEntry.timestamps[0]));

        info = {
          key,
          windowMs,
          maxRequests,
          currentRequests,
          remainingRequests,
          resetInMs,
        };

        if (currentRequests > maxRequests) {
          isBlocked = true;
        }
      }

      if (headersEnabled) {
        setRateLimitHeaders(res, info, retryAfterHeader, customHeaders);
      }

      if (isBlocked) {
        if (!limitReachedClients.has(key)) {
          limitReachedClients.add(key);
          if (onLimitReached) {
            onLimitReached(req, res, info);
          }
        }

        if (onBlocked) {
          onBlocked(req, res, info);
        } else {
          res.status(429).json({
            error: 'Too Many Requests',
            retryAfter: Math.ceil(info.resetInMs / 1000),
          });
        }

        if (metrics?.recordBlocked) {
          metrics.recordBlocked(req, info);
        }

        return;
      }

      if (metrics?.recordAllowed) {
        metrics.recordAllowed(req, info);
      }

      if (metrics?.recordCurrentUsage) {
        metrics.recordCurrentUsage(req, info);
      }

      if (info.remainingRequests > 0 && limitReachedClients.has(key)) {
        limitReachedClients.delete(key);
      }

      next();
    } catch (error) {
      logger.error('Rate limiter error:', error);
      next();
    }
  };
}

/**
 * Default key generator using client IP address.
 */
function defaultKeyGenerator(req: Request): string {
  return req.ip || 'unknown';
}

function createOrUpdateSlidingWindowEntry(
  entry: RateLimiterEntry | null,
  now: number,
  windowMs: number
): SlidingWindowEntry {
  const windowStart = now - windowMs;
  const currentEntry: SlidingWindowEntry =
    entry && entry.type === 'sliding-window'
      ? entry
      : { type: 'sliding-window', timestamps: [], lastAccessedAt: now };

  currentEntry.timestamps = currentEntry.timestamps.filter((timestamp) => timestamp > windowStart);
  currentEntry.timestamps.push(now);
  currentEntry.lastAccessedAt = now;

  return currentEntry;
}

function createOrUpdateTokenBucketEntry(
  entry: RateLimiterEntry | null,
  now: number,
  bucketSize: number,
  refillRate: number
): { bucketEntry: TokenBucketEntry; allowed: boolean } {
  const currentEntry: TokenBucketEntry =
    entry && entry.type === 'token-bucket'
      ? entry
      : {
          type: 'token-bucket',
          tokens: bucketSize,
          lastRefillAt: now,
          bucketSize,
          refillRate,
          lastAccessedAt: now,
        };

  const elapsedMs = now - currentEntry.lastRefillAt;
  const refillTokens = (elapsedMs / 1000) * currentEntry.refillRate;
  const availableTokens = Math.min(currentEntry.bucketSize, currentEntry.tokens + refillTokens);
  const allowed = availableTokens >= 1;

  currentEntry.tokens = allowed ? availableTokens - 1 : availableTokens;
  currentEntry.lastRefillAt = now;
  currentEntry.lastAccessedAt = now;
  currentEntry.bucketSize = bucketSize;
  currentEntry.refillRate = refillRate;

  return { bucketEntry: currentEntry, allowed };
}

function setRateLimitHeaders(
  res: Response,
  info: RateLimitInfo,
  retryAfterHeader: boolean,
  customHeaders?: Record<string, string | number>
): void {
  res.setHeader('X-RateLimit-Limit', info.maxRequests);
  res.setHeader('X-RateLimit-Remaining', info.remainingRequests);
  res.setHeader('X-RateLimit-Reset', Math.ceil((Date.now() + info.resetInMs) / 1000));

  if (retryAfterHeader && info.remainingRequests === 0) {
    res.setHeader('Retry-After', Math.ceil(info.resetInMs / 1000));
  }

  if (customHeaders) {
    for (const [name, value] of Object.entries(customHeaders)) {
      res.setHeader(name, String(value));
    }
  }
}

export { InMemoryStore } from './store';
export * from './types';
