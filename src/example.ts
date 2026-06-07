import express, { Request, Response } from 'express';
import { createRateLimiter, RateLimitInfo, RateLimiterLogger } from './index';

const app = express();
const PORT = 3000;

// Example: Custom logger implementation
class CustomLogger implements RateLimiterLogger {
  private prefix = '[RateLimiter]';

  log(...args: any[]): void {
    console.log(this.prefix, ...args);
  }

  warn(...args: any[]): void {
    console.warn(this.prefix, ...args);
  }

  error(...args: any[]): void {
    console.error(this.prefix, ...args);
  }
}

// Create a sliding-window rate limiter: 10 requests per 60 seconds
const slidingWindowLimiter = createRateLimiter({
  algorithm: 'sliding-window',
  windowMs: 60_000, // 60 seconds
  maxRequests: 10,
  headers: {
    enabled: true,
    retryAfterHeader: true,
  },
  skip: (req) => {
    // Skip rate limiting for health checks and token bucket endpoints
    return req.path === '/health' || req.path.startsWith('/tokenbucket');
  },
  logger: new CustomLogger(),
  onLimitReached: (req, res, info) => {
    console.warn(`⚠️  Sliding window limit reached for ${info.key}`);
    console.warn(`   Requests: ${info.currentRequests}/${info.maxRequests}`);
  },
  onBlocked: (req, res, info) => {
    console.error(`❌ Sliding window request blocked for ${info.key}`);
    res.status(429).json({
      error: 'Too Many Requests',
      message: `Rate limit exceeded. Maximum ${info.maxRequests} requests per ${info.windowMs}ms allowed.`,
      retryAfter: Math.ceil(info.resetInMs / 1000),
    });
  },
  metrics: {
    recordAllowed: (req, info) => {
      console.log(
        `✅ Sliding window request allowed for ${info.key} | Remaining: ${info.remainingRequests}/${info.maxRequests}`
      );
    },
    recordBlocked: (req, info) => {
      console.log(`🚫 Sliding window request blocked for ${info.key} | Reset in: ${info.resetInMs}ms`);
    },
  },
});

// Apply sliding-window rate limiter to all main routes
app.use(slidingWindowLimiter);

// Health check endpoint (not rate limited)
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'healthy' });
});

// Main API endpoint
app.get('/', (req: Request, res: Response) => {
  res.json({
    message: 'OK',
    timestamp: new Date().toISOString(),
  });
});

// Echo endpoint to test with query params
app.get('/echo', (req: Request, res: Response) => {
  res.json({
    message: req.query.message || 'echo',
    headers: {
      'X-RateLimit-Limit': res.getHeader('X-RateLimit-Limit'),
      'X-RateLimit-Remaining': res.getHeader('X-RateLimit-Remaining'),
      'X-RateLimit-Reset': res.getHeader('X-RateLimit-Reset'),
    },
  });
});

// Token bucket limiter demo
const tokenBucketLimiter = createRateLimiter({
  algorithm: 'token-bucket',
  windowMs: 60_000,
  maxRequests: 5,
  tokenBucket: {
    bucketSize: 5,
    refillRate: 1, // 1 token per second
  },
  headers: {
    enabled: true,
    retryAfterHeader: true,
  },
  skip: (req) => req.path === '/health',
  logger: new CustomLogger(),
  onLimitReached: (req, res, info) => {
    console.warn(`⚠️  Token bucket limit reached for ${info.key}`);
    console.warn(`   Tokens left: ${info.remainingRequests}/${info.maxRequests}`);
  },
  onBlocked: (req, res, info) => {
    console.error(`❌ Token bucket request blocked for ${info.key}`);
    res.status(429).json({
      error: 'Too Many Requests',
      message: `Rate limit exceeded. Bucket has no available tokens.`,
      retryAfter: Math.ceil(info.resetInMs / 1000),
    });
  },
});

const tokenBucketRouter = express.Router();
tokenBucketRouter.use(tokenBucketLimiter);

tokenBucketRouter.get('/health', (req, res) => {
  res.json({ status: 'tokenbucket healthy' });
});

tokenBucketRouter.get('/', (req, res) => {
  res.json({
    message: 'Token bucket OK',
    timestamp: new Date().toISOString(),
  });
});

tokenBucketRouter.get('/echo', (req, res) => {
  res.json({
    message: req.query.message || 'tokenbucket echo',
    headers: {
      'X-RateLimit-Limit': res.getHeader('X-RateLimit-Limit'),
      'X-RateLimit-Remaining': res.getHeader('X-RateLimit-Remaining'),
      'X-RateLimit-Reset': res.getHeader('X-RateLimit-Reset'),
    },
  });
});

app.use('/tokenbucket', tokenBucketRouter);

app.listen(PORT, () => {
  console.log(`\n🚀 Rate Limiter Demo Server running on http://localhost:${PORT}\n`);
  console.log('Endpoints:');
  console.log(`  GET http://localhost:${PORT}/        - Main endpoint (sliding window rate limited)`);
  console.log(`  GET http://localhost:${PORT}/echo    - Echo endpoint (sliding window rate limited)`);
  console.log(`  GET http://localhost:${PORT}/health  - Health check (NOT rate limited)`);
  console.log(`  GET http://localhost:${PORT}/tokenbucket/        - Token bucket main endpoint`);
  console.log(`  GET http://localhost:${PORT}/tokenbucket/echo    - Token bucket echo endpoint`);
  console.log(`  GET http://localhost:${PORT}/tokenbucket/health  - Token bucket health check`);
  console.log('\nSliding window rate limit: 10 requests per 60 seconds');
  console.log('Token bucket rate limit: 5 tokens, refill 1 token per second');
});
