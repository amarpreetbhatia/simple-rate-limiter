# Rate Limiter Middleware Specification

## Overview

This specification defines a Node.js Express rate limiter middleware built in TypeScript. It limits requests by client IP address and supports configurable rate limiting algorithms, including sliding window and token bucket, so users can select the behavior that best fits their traffic profile.

The preferred interface is a factory function:

```ts
createRateLimiter(config: RateLimiterConfig): Express.RequestHandler
```

## Goals

- Limit requests per client IP address.
- Use sliding window rate limiting for smoother enforcement.
- Provide transparent configuration and strong TypeScript typings.
- Expose monitoring and observability hooks for metrics and logs.
- Fail safely and allow trusted clients to bypass or adjust limits.

## Core API

### Factory function

```ts
function createRateLimiter(config: RateLimiterConfig): RequestHandler;
```

### Types

```ts
import { RequestHandler } from 'express';

export interface RateLimiterConfig {
  algorithm?: 'sliding-window' | 'token-bucket';
  windowMs: number;         // Sliding window size in milliseconds or token bucket refill interval
  maxRequests: number;      // Maximum requests allowed in a window or bucket capacity
  tokenBucket?: TokenBucketConfig; // Optional token bucket settings when using token bucket
  keyGenerator?: (req: Request) => string; // Function to derive client key, default IP
  skip?: (req: Request) => boolean;       // Optional skip function for trusted traffic
  onLimitReached?: (req: Request, res: Response, info: RateLimitInfo) => void;
  onBlocked?: (req: Request, res: Response, info: RateLimitInfo) => void;
  headers?: boolean | RateLimiterHeadersConfig; // Send standard rate limit headers
  store?: RateLimiterStore;   // Optional custom store for distributed deployments
  metrics?: RateLimiterMetrics; // Optional metrics collector hooks
}

export interface TokenBucketConfig {
  bucketSize?: number;       // Maximum number of tokens in the bucket; defaults to maxRequests
  refillRate: number;        // Tokens replenished per second
}

export interface RateLimiterHeadersConfig {
  enabled: boolean;
  retryAfterHeader?: boolean;
  customHeaders?: Record<string, string | number>;
}

export interface RateLimiterStore {
  increment(key: string, timestamp: number): Promise<RateLimiterEntry>;
  get(key: string): Promise<RateLimiterEntry | null>;
  reset(key: string): Promise<void>;
}

export interface RateLimiterEntry {
  count: number;
  firstRequestAt: number;
  lastRequestAt: number;
}

export interface RateLimiterMetrics {
  recordAllowed?(req: Request, info: RateLimitInfo): void;
  recordBlocked?(req: Request, info: RateLimitInfo): void;
  recordCurrentUsage?(req: Request, info: RateLimitInfo): void;
}

export interface RateLimitInfo {
  key: string;
  windowMs: number;
  maxRequests: number;
  currentRequests: number;
  remainingRequests: number;
  resetInMs: number;
}
```

## Behavior

1. The middleware determines a client key using `keyGenerator`. By default, it uses the request IP address.
2. If `skip(req)` returns `true`, the request bypasses rate limiting.
3. The middleware adds or updates rate limit state in the store according to the selected algorithm.
4. If the request exceeds the allowed rate or available tokens, the middleware blocks the request.
5. If configured, response headers include the number of remaining requests or tokens and the reset time.
6. Monitoring hooks are called for allowed or blocked requests.

## Rate Limiting Algorithms

### Algorithm selection

The rate limiter supports two configurable algorithms:

- `sliding-window` (default): tracks requests over a moving time window for accurate burst control.
- `token-bucket`: maintains a bucket of tokens that refill over time, allowing smoother request pacing and controlled bursts.

Consumers can choose the algorithm that best matches their requirements.

### Sliding window behavior

The sliding window algorithm is ideal when the goal is a strict maximum number of requests in a recent interval.

Benefits:

- Reduces burstiness at window boundaries compared to fixed windows.
- Provides a more accurate view of recent traffic than a single fixed window.
- Works well when enforcing quotas like "N requests per minute." 

Behavior:

- Let `windowMs` be the configured time interval and `maxRequests` be the allowed requests.
- The middleware calculates the count of requests made in the interval `(now - windowMs, now]`.
- It can approximate the sliding window by combining current and prior request data.
- A well-designed implementation updates the store with timestamps and prunes or weights older entries.

### Token bucket behavior

The token bucket algorithm is useful when you want to allow steady request flow while also permitting short bursts.

Benefits:

- Smooths traffic over time by refilling tokens at a constant rate.
- Allows bursts up to the bucket capacity without exceeding average rate limits.
- Works well for APIs where a sustained rate is more important than strict per-window quotas.

Behavior:

- Each client has a bucket with a maximum number of tokens.
- The bucket refills at `refillRate` tokens per second, up to `bucketSize`.
- Each request consumes a token.
- If no tokens remain, the request is blocked until tokens replenish.
- `bucketSize` can default to `maxRequests` when not explicitly configured.

## Headers

If `headers` are enabled, the middleware should send the following headers on every response where rate limiting applies:

- `X-RateLimit-Limit`: total requests allowed in the window.
- `X-RateLimit-Remaining`: remaining requests in the current sliding window.
- `X-RateLimit-Reset`: seconds until the window resets.
- `Retry-After`: seconds until the next request is allowed when blocked.

## Monitoring and Logging

The middleware should support monitoring hooks that allow integrations with Prometheus, Datadog, New Relic, or custom observability solutions.

### Recommended metrics

- `rate_limiter_allowed_requests_total`
- `rate_limiter_blocked_requests_total`
- `rate_limiter_current_requests`
- `rate_limiter_window_reset_seconds`
- `rate_limiter_clients_tracked`

### Log events

- `rate_limiter.allowed` when a request is accepted.
- `rate_limiter.blocked` when a request is rejected.
- `rate_limiter.skipped` when a request bypasses checks.

## Error Handling

- If the store fails, default to a safe failure mode. Prefer allowing traffic if the infrastructure is unhealthy, but log the incident and optionally report a circuit-breaker state.
- Respond with `429 Too Many Requests` when rate limit exceeded.
- Include `Retry-After` when clients are blocked.
- Provide an `onBlocked` callback for custom behavior such as returning a JSON payload or audit event.

## Example Usage

```ts
import express from 'express';
import { createRateLimiter } from './rateLimiter';

const app = express();

const limiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 100,
  headers: true,
  onLimitReached: (req, res, info) => {
    console.warn(`Rate limit reached for ${info.key}`);
  },
  metrics: {
    recordAllowed: (req, info) => { /* send to metrics backend */ },
    recordBlocked: (req, info) => { /* send to metrics backend */ },
  },
});

app.use(limiter);

app.get('/', (req, res) => {
  res.send('OK');
});
```

## Configuration Options

- `algorithm`: `'sliding-window' | 'token-bucket'` — selects the rate limiting algorithm; defaults to `sliding-window`.
- `windowMs`: sliding window length in milliseconds or token bucket refill evaluation window.
- `maxRequests`: maximum number of requests allowed during the sliding window or bucket capacity when using token bucket.
- `tokenBucket`: optional token bucket settings when `algorithm` is `token-bucket`.
- `keyGenerator`: custom function to identify clients, default is `req.ip`.
- `skip`: conditional bypass for health checks, internal IPs, or static assets.
- `onLimitReached`: callback when a client first reaches the limit.
- `onBlocked`: callback when a request is blocked.
- `headers`: enable standard rate limit headers and `Retry-After` support.
- `store`: custom storage adapter for distributed or persistent deployments.
- `metrics`: hooks for instrumentation.

## Implementation Notes

- Prefer a store interface that supports async operations for Redis, Memcached, or other shared stores.
- For in-memory development mode, use a lightweight Map-based store with periodic cleanup.
- The middleware should maintain a sliding timestamped history per key or use a bucketed approximation.
- Ensure the `RequestHandler` is compatible with Express 4.x and 5.x.
- Document default values clearly.

## Summary

This specification defines a TypeScript Express middleware factory `createRateLimiter(config) => middleware` that enforces per-IP rate limiting using configurable algorithms (`sliding-window` or `token-bucket`), supports observability, and is extensible through custom stores and metrics hooks.
