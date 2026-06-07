import { Request, Response, RequestHandler } from 'express';

export interface RateLimiterLogger {
  log(...args: any[]): void;
  warn(...args: any[]): void;
  error(...args: any[]): void;
}

export interface RateLimiterConfig {
  windowMs: number; // Sliding window size in milliseconds
  maxRequests: number; // Maximum requests allowed per window
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
