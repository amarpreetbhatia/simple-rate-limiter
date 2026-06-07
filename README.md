# simple-rate-limiter

A TypeScript-based Express rate limiter middleware supporting both sliding window and token bucket algorithms for per-IP request limiting. Designed for transparency, observability, and extensibility.

> Documentation is published with GitHub Pages at: https://amarpreetbhatia.github.io/simple-rate-limiter
>
> Generate locally with `npm run docs:build` and open the output in `docs/`.

## Features

- ✅ **Algorithm selection** – Supports both sliding window and token bucket modes
- ✅ **Per-IP Rate Limiting** – Identifies clients by IP address (customizable)
- ✅ **Configurable Storage** – In-memory store provided; bring your own Redis/Memcached
- ✅ **Observability Hooks** – Metrics and monitoring integration support
- ✅ **Standard Headers** – Sends `X-RateLimit-*` and `Retry-After` headers
- ✅ **Safe Defaults** – Fails open; allows traffic if store fails
- ✅ **TypeScript Support** – Full type safety and IDE autocomplete

## Installation

```bash
npm install express
npm install --save-dev @types/express typescript ts-node
```

Once the package is published, install it with:

```bash
npm install simple-rate-limiter
```

## Quick Start

```typescript
import express from 'express';
import { createRateLimiter } from './index';

const app = express();

const limiter = createRateLimiter({
  windowMs: 60_000,      // 60 seconds
  maxRequests: 100,      // 100 requests per window
  headers: true,         // Enable rate limit headers
});

app.use(limiter);

app.get('/', (req, res) => {
  res.send('OK');
});

app.listen(3000);
```

## Configuration

### `RateLimiterConfig`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `algorithm` | `'sliding-window' \| 'token-bucket'` | `sliding-window` | Select which rate limiting algorithm to use |
| `windowMs` | `number` | required | Sliding window interval or token bucket evaluation window in ms |
| `maxRequests` | `number` | required | Allowed requests per window or token bucket capacity |
| `tokenBucket` | `TokenBucketConfig` | none | Optional token bucket settings when using `token-bucket` |
| `keyGenerator` | `(req) => string` | `req.ip` | Function to derive client key |
| `skip` | `(req) => boolean` | none | Skip rate limiting for specific requests |
| `headers` | `boolean \| object` | `false` | Enable standard rate limit headers |
| `store` | `RateLimiterStore` | `InMemoryStore` | Custom storage backend |
| `metrics` | `RateLimiterMetrics` | none | Observability hooks |
| `logger` | `RateLimiterLogger` | `console` | Custom logger instance |
| `onLimitReached` | `(req, res, info) => void` | none | Callback when limit first reached |
| `onBlocked` | `(req, res, info) => void` | none | Callback when request is blocked |

## Usage Examples

### Basic Setup

```typescript
const limiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 100,
});

app.use(limiter);
```

### With Custom Key Generator

Rate limit by user ID instead of IP:

```typescript
const limiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 50,
  keyGenerator: (req) => req.user?.id || req.ip,
});
```

### Skip Rate Limiting for Specific Routes

```typescript
const limiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 100,
  skip: (req) => req.path === '/health' || req.path === '/status',
});
```

### With Metrics Integration

```typescript
const limiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 100,
  metrics: {
    recordAllowed: (req, info) => {
      // Send to Prometheus, Datadog, etc.
      prometheus.counter('rate_limiter_allowed_total', 1);
    },
    recordBlocked: (req, info) => {
      prometheus.counter('rate_limiter_blocked_total', 1);
    },
    recordCurrentUsage: (req, info) => {
      prometheus.gauge('rate_limiter_current_requests', info.currentRequests);
    },
  },
});
```

### With Custom Logger

```typescript
import { RateLimiterLogger } from './index';

class CustomLogger implements RateLimiterLogger {
  log(...args: any[]): void {
    // Use your own logging system
    myLogger.info(...args);
  }

  warn(...args: any[]): void {
    myLogger.warn(...args);
  }

  error(...args: any[]): void {
    myLogger.error(...args);
  }
}

const limiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 100,
  logger: new CustomLogger(), // Optional; defaults to console
});
```

### Algorithm Selection

```typescript
const limiter = createRateLimiter({
  algorithm: 'token-bucket',
  windowMs: 60_000,
  maxRequests: 100,
  tokenBucket: {
    bucketSize: 100,
    refillRate: 1, // one token per second
  },
});
```

### Custom Response on Block

```typescript
const limiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 100,
  onBlocked: (req, res, info) => {
    res.status(429).json({
      error: 'Rate limit exceeded',
      retryAfter: Math.ceil(info.resetInMs / 1000),
    });
  },
});
```

### With Callbacks

```typescript
const limiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 100,
  onLimitReached: (req, res, info) => {
    console.warn(`Limit reached for ${info.key}`);
    // Send alert, log, etc.
  },
  onBlocked: (req, res, info) => {
    console.error(`Request blocked for ${info.key}`);
    res.status(429).send('Too many requests');
  },
});
```

### With Custom Store (Redis Example)

```typescript
import redis from 'redis';

const redisClient = redis.createClient();

const customStore: RateLimiterStore = {
  async get(key: string) {
    const data = await redisClient.get(key);
    return data ? JSON.parse(data) : null;
  },
  async set(key: string, entry: any) {
    await redisClient.set(key, JSON.stringify(entry), 'EX', 3600);
  },
  async reset(key: string) {
    await redisClient.del(key);
  },
};

const limiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 100,
  store: customStore,
});
```

## Response Headers

When `headers: true`, the middleware adds:

- `X-RateLimit-Limit` – Total requests allowed in the window
- `X-RateLimit-Remaining` – Remaining requests in current window
- `X-RateLimit-Reset` – Unix timestamp when window resets (seconds)
- `Retry-After` – Seconds to wait before retrying (only when blocked)

```
HTTP/1.1 200 OK
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1622548234
```

## Error Responses

When a request is blocked:

```json
{
  "error": "Too Many Requests",
  "retryAfter": 45
}
```

Status code: `429 Too Many Requests`

## Running the Example

```bash
# Build the TypeScript
npm run build

# Run the example server
npm run dev
```

The server will start on `http://localhost:3000` with a 10 requests/60 seconds limit.

Test with:

```bash
# Should succeed
curl http://localhost:3000/

# Make 10 requests
for i in {1..10}; do curl http://localhost:3000/; done

# 11th request should be blocked
curl http://localhost:3000/
```

## API Reference

### `createRateLimiter(config: RateLimiterConfig): RequestHandler`

Factory function that returns an Express middleware.

### Types

```typescript
interface TokenBucketConfig {
  bucketSize?: number; // Maximum tokens in the bucket
  refillRate?: number; // Tokens replenished per second
}

interface RateLimitInfo {
  key: string;                    // Client identifier
  windowMs: number;               // Window size or evaluation interval
  maxRequests: number;            // Request limit or bucket capacity
  currentRequests: number;        // Used requests or consumed tokens
  remainingRequests: number;      // Remaining allowed requests or available tokens
  resetInMs: number;              // ms until the next reset or token refill
}

interface RateLimiterLogger {
  log(...args: any[]): void;      // General logging
  warn(...args: any[]): void;     // Warning logging
  error(...args: any[]): void;    // Error logging
}

interface RateLimiterStore {
  get(key: string): Promise<RateLimiterEntry | null>;
  set(key: string, entry: RateLimiterEntry): Promise<void>;
  reset(key: string): Promise<void>;
}
```

## Algorithms

This middleware supports two rate limiting algorithms:

- `sliding-window`: ideal for request quotas over a moving time window.
- `token-bucket`: ideal for smoothing traffic and allowing controlled bursts.

### Sliding window behavior

- The middleware tracks request timestamps.
- It counts requests in the interval `[now - windowMs, now]`.
- If the count exceeds `maxRequests`, the request is blocked.

### Token bucket behavior

- Each client has a bucket of tokens.
- The bucket refills at `refillRate` tokens per second.
- Each request consumes one token.
- If tokens are unavailable, the request is blocked until tokens replenish.

## Error Handling

The middleware implements **fail-open** semantics:

- If the store fails to respond, the request is **allowed**.
- An error is logged for monitoring.
- This ensures the rate limiter doesn't become a point of failure.

## Performance Considerations

- **In-memory store**: Suitable for single-instance deployments; avoid using it for very high client counts.
- **Distributed store**: Use Redis/Memcached for multi-instance deployments.
- **Cleanup**: In-memory store periodically removes stale entries to prevent memory growth.

## License

MIT
