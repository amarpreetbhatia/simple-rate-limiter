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

// Create a rate limiter: 10 requests per 60 seconds
const limiter = createRateLimiter({
  windowMs: 60_000, // 60 seconds
  maxRequests: 10,
  headers: {
    enabled: true,
    retryAfterHeader: true,
  },
  skip: (req) => {
    // Skip rate limiting for health check endpoints
    return req.path === '/health';
  },
  logger: new CustomLogger(), // Use custom logger (optional, defaults to console)
  onLimitReached: (req, res, info) => {
    console.warn(`⚠️  Rate limit reached for ${info.key}`);
    console.warn(`   Requests: ${info.currentRequests}/${info.maxRequests}`);
  },
  onBlocked: (req, res, info) => {
    console.error(`❌ Request blocked for ${info.key}`);
    res.status(429).json({
      error: 'Too Many Requests',
      message: `Rate limit exceeded. Maximum ${info.maxRequests} requests per ${info.windowMs}ms allowed.`,
      retryAfter: Math.ceil(info.resetInMs / 1000),
    });
  },
  metrics: {
    recordAllowed: (req, info) => {
      console.log(
        `✅ Request allowed for ${info.key} | Remaining: ${info.remainingRequests}/${info.maxRequests}`
      );
    },
    recordBlocked: (req, info) => {
      console.log(`🚫 Request blocked for ${info.key} | Reset in: ${info.resetInMs}ms`);
    },
  },
});

// Apply rate limiter to all routes
app.use(limiter);

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

app.listen(PORT, () => {
  console.log(`\n🚀 Rate Limiter Demo Server running on http://localhost:${PORT}\n`);
  console.log('Endpoints:');
  console.log(`  GET http://localhost:${PORT}/        - Main endpoint (rate limited)`);
  console.log(`  GET http://localhost:${PORT}/echo    - Echo endpoint (rate limited)`);
  console.log(`  GET http://localhost:${PORT}/health  - Health check (NOT rate limited)\n`);
  console.log('Rate limit: 10 requests per 60 seconds\n');
});
