import { Request, Response, RequestHandler } from 'express';

export interface RateLimiterLogger {
  log(...args: any[]): void;
  warn(...args: any[]): void;
  error(...args: any[]): void;
}

export type RateLimiterAlgorithm = 'sliding-window' | 'token-bucket';

export interface TokenBucketConfig {
  bucketSize?: number;       // Maximum tokens in the bucket; defaults to maxRequests
  refillRate?: number;       // Tokens replenished per second; defaults to maxRequests / (windowMs / 1000)
}

export interface RateLimiterConfig {
  algorithm?: RateLimiterAlgorithm;
  windowMs: number; // Sliding window size in milliseconds or token bucket refill evaluation window
  maxRequests: number; // Maximum requests allowed per window or bucket capacity
  tokenBucket?: TokenBucketConfig; // Optional token bucket settings when using token bucket
  keyGenerator?: (req: Request) => string; // Function to derive client key, default IP
  skip?: (req: Request) => boolean; // Optional skip function for trusted traffic
  onLimitReached?: (req: Request, res: Response, info: RateLimitInfo) => void;
  onBlocked?: (req: Request, res: Response, info: RateLimitInfo) => void;
  headers?: boolean | RateLimiterHeadersConfig; // Send standard rate limit headers
  store?: RateLimiterStore; // Optional custom store for distributed deployments
  metrics?: RateLimiterMetrics; // Optional metrics collector hooks
  logger?: RateLimiterLogger; // Optional custom logger, defaults to console
}

export interface RateLimiterHeadersConfig {
  enabled: boolean;
  retryAfterHeader?: boolean;
  customHeaders?: Record<string, string | number>;
}

export interface RateLimiterStore {
  get(key: string): Promise<RateLimiterEntry | null>;
  set(key: string, entry: RateLimiterEntry): Promise<void>;
  reset(key: string): Promise<void>;
}

export interface SlidingWindowEntry {
  type: 'sliding-window';
  timestamps: number[];
  lastAccessedAt: number;
}

export interface TokenBucketEntry {
  type: 'token-bucket';
  tokens: number;
  lastRefillAt: number;
  bucketSize: number;
  refillRate: number;
  lastAccessedAt: number;
}

export type RateLimiterEntry = SlidingWindowEntry | TokenBucketEntry;

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
