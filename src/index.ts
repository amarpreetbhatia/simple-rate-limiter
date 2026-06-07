import { Request, Response, RequestHandler } from 'express';
import {
  RateLimiterConfig,
  RateLimiterStore,
  RateLimiterLogger,
  RateLimiterHeadersConfig,
  RateLimitInfo,
} from './types';
import { InMemoryStore } from './store';

/**
 * Default logger that wraps console methods
 */
const createDefaultLogger = (): RateLimiterLogger => ({
  log: (...args: any[]) => console.log(...args),
  warn: (...args: any[]) => console.warn(...args),
  error: (...args: any[]) => console.error(...args),
});

export function createRateLimiter(config: RateLimiterConfig): RequestHandler {
  const {
    windowMs,
    maxRequests,
    keyGenerator = defaultKeyGenerator,
    skip,
    onLimitReached,
    onBlocked,
    headers: headersConfig = false,
    store = new InMemoryStore(windowMs),
    metrics,
    logger = createDefaultLogger(),
  } = config;

  // Normalize headers config
  const headersEnabled =
    typeof headersConfig === 'boolean' ? headersConfig : headersConfig.enabled;
  const retryAfterHeader =
    typeof headersConfig === 'object' ? headersConfig.retryAfterHeader !== false : true;

  // Track which clients have triggered the limit callback
  const limitReachedClients = new Set<string>();

  return async (req: Request, res: Response, next: Function) => {
    try {
      // Check if this request should skip rate limiting
      if (skip && skip(req)) {
        return next();
      }

      const key = keyGenerator(req);
      const now = Date.now();

      // Get or create the entry in the store
      const entry = await store.increment(key, now);

      // Calculate requests within the sliding window
      const windowStart = now - windowMs;
      const requestsInWindow =
        entry.firstRequestAt <= windowStart
          ? calculateWindowRequests(entry, now, windowMs)
          : entry.count;

      const remainingRequests = Math.max(0, maxRequests - requestsInWindow);
      const resetInMs = Math.max(0, entry.firstRequestAt + windowMs - now);

      const info: RateLimitInfo = {
        key,
        windowMs,
        maxRequests,
        currentRequests: requestsInWindow,
        remainingRequests,
        resetInMs,
      };

      // Set response headers if enabled
      if (headersEnabled) {
        setRateLimitHeaders(res, info, retryAfterHeader);
      }

      // Check if limit exceeded
      if (requestsInWindow > maxRequests) {
        // Call onLimitReached only once per client
        if (!limitReachedClients.has(key)) {
          limitReachedClients.add(key);
          if (onLimitReached) {
            onLimitReached(req, res, info);
          }
        }

        // Block the request
        if (onBlocked) {
          onBlocked(req, res, info);
        } else {
          // Default behavior: respond with 429 Too Many Requests
          res.status(429).json({
            error: 'Too Many Requests',
            retryAfter: Math.ceil(resetInMs / 1000),
          });
        }

        // Record blocked metric
        if (metrics?.recordBlocked) {
          metrics.recordBlocked(req, info);
        }

        return;
      }

      // Request is allowed
      if (metrics?.recordAllowed) {
        metrics.recordAllowed(req, info);
      }

      if (metrics?.recordCurrentUsage) {
        metrics.recordCurrentUsage(req, info);
      }

      // Clean up the limit reached set for this client to prepare for next window
      if (remainingRequests > 0 && limitReachedClients.has(key)) {
        limitReachedClients.delete(key);
      }

      next();
    } catch (error) {
      // Fail open: allow traffic if store fails, but log the error
      logger.error('Rate limiter error:', error);
      // Log incident but allow the request
      next();
    }
  };
}

/**
 * Default key generator using client IP address
 */
function defaultKeyGenerator(req: Request): string {
  return req.ip || 'unknown';
}

/**
 * Calculate approximate requests in the sliding window
 * Using a simple approach: if the window spans two time buckets,
 * we weight the requests proportionally
 */
function calculateWindowRequests(
  entry: { count: number; firstRequestAt: number; lastRequestAt: number },
  now: number,
  windowMs: number
): number {
  const windowStart = now - windowMs;

  // If all requests are within the window, count them all
  if (entry.firstRequestAt > windowStart) {
    return entry.count;
  }

  // If the oldest request is before the window start,
  // we assume requests are distributed over time
  // For simplicity, we count all recent requests
  // A more sophisticated implementation would track individual timestamps
  return Math.max(1, entry.count);
}

/**
 * Set standard rate limit headers on the response
 */
function setRateLimitHeaders(
  res: Response,
  info: RateLimitInfo,
  retryAfterHeader: boolean
): void {
  res.setHeader('X-RateLimit-Limit', info.maxRequests);
  res.setHeader('X-RateLimit-Remaining', info.remainingRequests);
  res.setHeader('X-RateLimit-Reset', Math.ceil((Date.now() + info.resetInMs) / 1000));

  if (retryAfterHeader && info.remainingRequests === 0) {
    res.setHeader('Retry-After', Math.ceil(info.resetInMs / 1000));
  }
}

export { InMemoryStore } from './store';
export * from './types';
