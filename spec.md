# Rate Limiter Middleware Specification

## Overview

This specification defines a Node.js Express rate limiter middleware built in TypeScript. It limits requests by client IP address and uses a sliding window algorithm to minimize burstiness while staying accurate over time.

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
  windowMs: number;         // Sliding window size in milliseconds
  maxRequests: number;      // Maximum requests allowed per window
  keyGenerator?: (req: Request) => string; // Function to derive client key, default IP
  skip?: (req: Request) => boolean;       // Optional skip function for trusted traffic
  onLimitReached?: (req: Request, res: Response, info: RateLimitInfo) => void;
  onBlocked?: (req: Request, res: Response, info: RateLimitInfo) => void;
  headers?: boolean | RateLimiterHeadersConfig; // Send standard rate limit headers
  store?: RateLimiterStore;   // Optional custom store for distributed deployments
  metrics?: RateLimiterMetrics; // Optional metrics collector hooks
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
3. The middleware adds or updates a sliding window counter in the store.
4. If the request count exceeds `maxRequests`, the middleware blocks the request.
5. If configured, response headers include the number of remaining requests and the reset time.
6. Monitoring hooks are called for allowed or blocked requests.

## Sliding Window Algorithm

### Why sliding window?

The sliding window algorithm is chosen because it provides a better balance of fairness and enforcement compared to the fixed window approach.

Benefits over fixed window:

- Reduces burstiness at window boundaries. Fixed windows allow a burst of up to `2 * limit` when a client sends requests at the end of one window and the beginning of the next.
- More accurate representation of recent traffic, because limits are evaluated continuously across the configured interval.
- Better UX for clients, since limits are not reset abruptly at discrete boundaries.

Benefits over token bucket and leaky bucket for this use case:

- Simpler to reason about for request-count limits over a time window.
- More deterministic behavior when the goal is "N requests per interval" rather than controlling rate over time.
- Easier to implement with an in-memory or distributed sliding counter store.

### Sliding window behavior

- Let `windowMs` be the configured time interval, and `maxRequests` be the allowed requests.
- The middleware calculates the count of requests made in the interval `(now - windowMs, now]`.
- It can approximate the sliding window by combining the current bucket and the previous bucket proportionally.
- A well-designed implementation updates the store with the current timestamp and prunes or weights older requests.

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

- `windowMs`: sliding window length in milliseconds.
- `maxRequests`: maximum number of requests allowed during the sliding window.
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

This specification defines a TypeScript Express middleware factory `createRateLimiter(config) => middleware` that enforces per-IP rate limiting using the sliding window algorithm, supports observability, and is extensible through custom stores and metrics hooks.
