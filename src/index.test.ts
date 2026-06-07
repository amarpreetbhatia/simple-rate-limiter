import express, { Request, Response } from 'express';
import request from 'supertest';
import { createRateLimiter, InMemoryStore } from './index';
import { RateLimiterLogger } from './types';

describe('createRateLimiter', () => {
  it('allows requests below the limit', async () => {
    const app = express();
    app.use(createRateLimiter({ windowMs: 1000, maxRequests: 2 }));
    app.get('/', (req, res) => res.status(200).send('ok'));

    await request(app).get('/').expect(200, 'ok');
    await request(app).get('/').expect(200, 'ok');
  });

  it('blocks requests above the limit', async () => {
    const app = express();
    app.use(createRateLimiter({ windowMs: 1000, maxRequests: 1, headers: true }));
    app.get('/', (req, res) => res.status(200).send('ok'));

    await request(app).get('/').expect(200, 'ok');
    const response = await request(app).get('/').expect(429);

    expect(response.body).toEqual({
      error: 'Too Many Requests',
      retryAfter: expect.any(Number),
    });
    expect(response.headers['x-ratelimit-limit']).toBe('1');
    expect(response.headers['x-ratelimit-remaining']).toBe('0');
    expect(response.headers['retry-after']).toBeDefined();
  });

  it('skips rate limiting when skip returns true', async () => {
    const app = express();
    app.use(
      createRateLimiter({
        windowMs: 1000,
        maxRequests: 1,
        skip: (req) => req.path === '/health',
      })
    );
    app.get('/health', (req, res) => res.status(200).send('healthy'));

    await request(app).get('/health').expect(200, 'healthy');
    await request(app).get('/health').expect(200, 'healthy');
  });

  it('uses the provided custom logger when errors occur', async () => {
    const logger: RateLimiterLogger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    const app = express();
    app.use(
      createRateLimiter({
        windowMs: 1000,
        maxRequests: 1,
        logger,
        store: {
          increment: async () => {
            throw new Error('store failure');
          },
          get: async () => null,
          reset: async () => undefined,
        },
      })
    );
    app.get('/', (req, res) => res.status(200).send('ok'));

    await request(app).get('/').expect(200, 'ok');
    expect(logger.error).toHaveBeenCalledWith('Rate limiter error:', expect.any(Error));
  });

  it('sets standard rate limit headers when enabled', async () => {
    const app = express();
    app.use(createRateLimiter({ windowMs: 1000, maxRequests: 2, headers: true }));
    app.get('/', (req, res) => res.status(200).send('ok'));

    const response = await request(app).get('/').expect(200, 'ok');
    expect(response.headers['x-ratelimit-limit']).toBe('2');
    expect(response.headers['x-ratelimit-remaining']).toBe('1');
    expect(response.headers['x-ratelimit-reset']).toBeDefined();
  });
});
