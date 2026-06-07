# Rate Limiter Middleware

A TypeScript-based Express rate limiter middleware using the sliding window algorithm to limit requests by client IP address. Designed for transparency, observability, and extensibility.

## Features

- ✅ **Sliding Window Algorithm** – Smoother rate limiting without fixed window boundaries
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
| `windowMs` | `number` | required | Sliding window size in milliseconds |
| `maxRequests` | `number` | required | Maximum requests per window |
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
  async increment(key: string, timestamp: number) {
    const entry = JSON.parse(await redisClient.get(key) || '{}');
    entry.count = (entry.count || 0) + 1;
    entry.lastRequestAt = timestamp;
    if (!entry.firstRequestAt) entry.firstRequestAt = timestamp;
    await redisClient.set(key, JSON.stringify(entry), 'EX', 3600);
    return entry;
  },
  async get(key: string) {
    const data = await redisClient.get(key);
    return data ? JSON.parse(data) : null;
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
interface RateLimitInfo {
  key: string;                    // Client identifier
  windowMs: number;               // Window size
  maxRequests: number;            // Request limit
  currentRequests: number;        // Requests in current window
  remainingRequests: number;      // Remaining allowed requests
  resetInMs: number;              // ms until window resets
}

interface RateLimiterLogger {
  log(...args: any[]): void;      // General logging
  warn(...args: any[]): void;     // Warning logging
  error(...args: any[]): void;    // Error logging
}

interface RateLimiterStore {
  increment(key: string, timestamp: number): Promise<RateLimiterEntry>;
  get(key: string): Promise<RateLimiterEntry | null>;
  reset(key: string): Promise<void>;
}
```

## Sliding Window Algorithm

The middleware uses a sliding window algorithm, which provides better fairness than fixed windows:

- **No burst at boundaries**: Prevents doubling of requests at window boundaries
- **Continuous evaluation**: Limits evaluated over actual recent interval
- **Better UX**: More gradual degradation as users approach limits

### How it works

1. Increment counter for client at current timestamp
2. Calculate requests in interval `[now - windowMs, now]`
3. If count exceeds `maxRequests`, block request
4. Otherwise, allow and track in metrics

## Error Handling

The middleware implements **fail-open** semantics:

- If the store fails to respond, the request is **allowed**
- An error is logged for monitoring
- This ensures the rate limiter doesn't become a point of failure

## Performance Considerations

- **In-memory store**: Suitable for single-instance deployments; ~1000 active clients max
- **Distributed store**: Use Redis/Memcached for multi-instance deployments
- **Cleanup**: In-memory store periodically cleans old entries to prevent memory leaks

# Running in Codebase
- Step 1 `sudo apt update`
- Step 2 `sudo add-apt-repository universe`
- Step 3 `sudo apt update`
- Step 4 `sudo apt install bubblewrap socat`

## License

MIT
