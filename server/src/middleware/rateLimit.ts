import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import type { Request, RequestHandler } from 'express';
import { ApiError } from '../errors';
import {
  DEFAULT_DAILY_RATE_LIMIT_MAX,
  DEFAULT_DAILY_RATE_LIMIT_WINDOW_MS,
  DEFAULT_GLOBAL_DAILY_RATE_LIMIT_MAX,
  DEFAULT_AUTH_DAILY_RATE_LIMIT_MAX,
  DEFAULT_AUTH_RATE_LIMIT_MAX,
  DEFAULT_RATE_LIMIT_MAX,
  DEFAULT_RATE_LIMIT_WINDOW_MS,
} from '../limits';
import { log } from '../logger';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export interface RateLimiterStatus {
  store: 'upstash' | 'in-memory';
  configured: boolean;
  ready: boolean;
  latencyMs?: number;
  error?: string;
}

const hits = new Map<string, RateLimitEntry>();
const dailyHits = new Map<string, RateLimitEntry>();

const PRUNE_INTERVAL_MS = 60_000;
let lastPruneAt = Date.now();

function pruneExpiredEntries(): void {
  const now = Date.now();
  if (now - lastPruneAt < PRUNE_INTERVAL_MS) return;
  lastPruneAt = now;
  for (const [key, entry] of hits) {
    if (now >= entry.resetAt) hits.delete(key);
  }
  for (const [key, entry] of dailyHits) {
    if (now >= entry.resetAt) dailyHits.delete(key);
  }
}

function parseEnvInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getRateLimitKey(req: Request): string {
  // 1. Specific user or account identity if provided under verified Bearer auth
  const customUser = req.header('x-user-id')?.trim();
  if (customUser && req.auth?.type === 'bearer') {
    return `user:${customUser}`;
  }
  if (req.auth?.identity && req.auth.type === 'bearer') {
    return `auth:${req.auth.identity}`;
  }
  // 2. Caller IP for anonymous / public visitors
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  return `ip:${ip}`;
}

function isBearerAuthenticated(req: Request): boolean {
  return req.auth?.type === 'bearer';
}

function createUpstashLimiters(
  max: number,
  windowMs: number,
  dailyMax: number,
  authMax: number,
  authWindowMs: number,
  authDailyMax: number,
  globalDailyMax: number,
): { minute: Ratelimit; daily: Ratelimit; authMinute: Ratelimit; authDaily: Ratelimit; globalDaily: Ratelimit } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;

  const redis = new Redis({ url, token });
  const windowSec = Math.max(1, Math.ceil(windowMs / 1000));
  const minute = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(max, `${windowSec} s`),
    prefix: 'llm-chart-maker',
  });
  const daily = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(dailyMax, '24 h'),
    prefix: 'llm-chart-maker-daily',
  });
  const authMinute = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(authMax, `${Math.max(1, Math.ceil(authWindowMs / 1000))} s`),
    prefix: 'llm-chart-generator-auth',
  });
  const authDaily = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(authDailyMax, '24 h'),
    prefix: 'llm-chart-generator-auth-daily',
  });
  const globalDaily = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(globalDailyMax, '24 h'),
    prefix: 'llm-chart-generator-global-daily',
  });
  return { minute, daily, authMinute, authDaily, globalDaily };
}

export async function verifyUpstashConnection(): Promise<RateLimiterStatus> {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) {
    return { store: 'in-memory', configured: false, ready: true };
  }

  const start = Date.now();
  try {
    const redis = new Redis({ url, token });
    await redis.ping();
    const latencyMs = Date.now() - start;
    return { store: 'upstash', configured: true, ready: true, latencyMs };
  } catch (err) {
    const latencyMs = Date.now() - start;
    const error = err instanceof Error ? err.message : String(err);
    log('warn', 'Upstash Redis ping failed', { error, latencyMs });
    return { store: 'upstash', configured: true, ready: false, latencyMs, error };
  }
}

function rateLimitExceededError(resetAtMs: number): ApiError {
  const retrySec = Math.max(1, Math.ceil((resetAtMs - Date.now()) / 1000));
  return new ApiError(
    `Rate limit exceeded. Try again in ${retrySec} seconds.`,
    429,
    'RATE_LIMIT_EXCEEDED',
  );
}

function dailyQuotaExceededError(resetAtMs: number, dailyMax: number): ApiError {
  const retrySec = Math.max(1, Math.ceil((resetAtMs - Date.now()) / 1000));
  return new ApiError(
    `Daily request quota exceeded (${dailyMax} requests/day). Try again in ${Math.ceil(retrySec / 3600)} hours.`,
    429,
    'DAILY_QUOTA_EXCEEDED',
  );
}

function applyInMemoryLimit(
  req: Request,
  res: import('express').Response,
  next: import('express').NextFunction,
  max: number,
  windowMs: number,
  dailyMax: number,
  dailyWindowMs: number,
): void {
  if (isBearerAuthenticated(req)) {
    return next();
  }

  const key = getRateLimitKey(req);
  const error = consumeInMemoryKey(key, res, max, windowMs, dailyMax, dailyWindowMs);
  if (error) return next(error);
  next();
}

function consumeInMemoryKey(
  key: string,
  res: import('express').Response,
  max: number,
  windowMs: number,
  dailyMax: number,
  dailyWindowMs: number,
): ApiError | null {
  const dailyError = consumeInMemoryDailyKey(key, res, dailyMax, dailyWindowMs);
  if (dailyError) return dailyError;
  const now = Date.now();

  // 2. Enforce Sliding Window Limit
  let entry = hits.get(key);
  if (!entry || now >= entry.resetAt) {
    entry = { count: 0, resetAt: now + windowMs };
    hits.set(key, entry);
  }

  entry.count += 1;
  const remaining = Math.max(0, max - entry.count);
  const resetSec = Math.ceil(entry.resetAt / 1000);

  res.setHeader('X-RateLimit-Limit', max);
  res.setHeader('X-RateLimit-Remaining', remaining);
  res.setHeader('X-RateLimit-Reset', resetSec);

  if (entry.count > max) {
    const retrySec = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    res.setHeader('Retry-After', retrySec);
    return rateLimitExceededError(entry.resetAt);
  }
  return null;
}

function consumeInMemoryDailyKey(
  key: string,
  res: import('express').Response,
  dailyMax: number,
  dailyWindowMs: number,
): ApiError | null {
  pruneExpiredEntries();
  const now = Date.now();
  let dailyEntry = dailyHits.get(key);
  if (!dailyEntry || now >= dailyEntry.resetAt) {
    dailyEntry = { count: 0, resetAt: now + dailyWindowMs };
    dailyHits.set(key, dailyEntry);
  }
  dailyEntry.count += 1;
  if (dailyEntry.count > dailyMax) {
    res.setHeader('Retry-After', Math.max(1, Math.ceil((dailyEntry.resetAt - now) / 1000)));
    return dailyQuotaExceededError(dailyEntry.resetAt, dailyMax);
  }
  return null;
}

function applyInMemoryAuthLimit(
  req: Request,
  res: import('express').Response,
  next: import('express').NextFunction,
  max: number,
  windowMs: number,
  dailyMax: number,
  dailyWindowMs: number,
): void {
  const identity = getRateLimitKey(req);
  const ip = `ip:${req.ip || req.socket.remoteAddress || 'unknown'}`;
  const identityError = consumeInMemoryKey(`auth:${identity}`, res, max, windowMs, dailyMax, dailyWindowMs);
  if (identityError) return next(identityError);
  const ipError = consumeInMemoryKey(`auth:${ip}`, res, max, windowMs, dailyMax, dailyWindowMs);
  if (ipError) return next(ipError);
  next();
}

export function createLlmRateLimiter(): RequestHandler {
  const windowMs = parseEnvInt('RATE_LIMIT_WINDOW_MS', DEFAULT_RATE_LIMIT_WINDOW_MS);
  const max = parseEnvInt('RATE_LIMIT_MAX', DEFAULT_RATE_LIMIT_MAX);
  const dailyMax = parseEnvInt('DAILY_RATE_LIMIT_MAX', DEFAULT_DAILY_RATE_LIMIT_MAX);
  const dailyWindowMs = parseEnvInt('DAILY_RATE_LIMIT_WINDOW_MS', DEFAULT_DAILY_RATE_LIMIT_WINDOW_MS);
  const authMax = parseEnvInt('AUTH_RATE_LIMIT_MAX', DEFAULT_AUTH_RATE_LIMIT_MAX);
  const authWindowMs = parseEnvInt('AUTH_RATE_LIMIT_WINDOW_MS', DEFAULT_RATE_LIMIT_WINDOW_MS);
  const authDailyMax = parseEnvInt('AUTH_DAILY_RATE_LIMIT_MAX', DEFAULT_AUTH_DAILY_RATE_LIMIT_MAX);
  const globalDailyMax = parseEnvInt('GLOBAL_DAILY_RATE_LIMIT_MAX', DEFAULT_GLOBAL_DAILY_RATE_LIMIT_MAX);

  const limiters = createUpstashLimiters(max, windowMs, dailyMax, authMax, authWindowMs, authDailyMax, globalDailyMax);

  const applyInMemoryGlobalDailyLimit = (res: import('express').Response, next: import('express').NextFunction): boolean => {
    const error = consumeInMemoryDailyKey('global:all', res, globalDailyMax, dailyWindowMs);
    if (!error) return false;
    next(error);
    return true;
  };

  const applyAuthenticatedInMemoryLimit = (req: Request, res: import('express').Response, next: import('express').NextFunction) => {
    if (applyInMemoryGlobalDailyLimit(res, next)) return;
    applyInMemoryAuthLimit(req, res, next, authMax, authWindowMs, authDailyMax, dailyWindowMs);
  };
  const applyAuthenticatedInMemoryBuckets = (req: Request, res: import('express').Response, next: import('express').NextFunction) =>
    applyInMemoryAuthLimit(req, res, next, authMax, authWindowMs, authDailyMax, dailyWindowMs);
  const applyPublicInMemoryLimit = (req: Request, res: import('express').Response, next: import('express').NextFunction) => {
    if (applyInMemoryGlobalDailyLimit(res, next)) return;
    applyInMemoryLimit(req, res, next, max, windowMs, dailyMax, dailyWindowMs);
  };

  if (limiters) {
    log('info', 'rate limiting via Upstash Redis', { max, windowMs, dailyMax });

    return async (req, res, next) => {
      try {
        const globalResult = await limiters.globalDaily.limit('all');
        if (!globalResult.success) {
          res.setHeader('Retry-After', Math.max(1, Math.ceil((globalResult.reset - Date.now()) / 1000)));
          return next(dailyQuotaExceededError(globalResult.reset, globalDailyMax));
        }
      } catch (err) {
        log('warn', 'Upstash global daily limiter unavailable; falling back to in-memory limiting', {
          error: err instanceof Error ? err.message : String(err),
        });
        return isBearerAuthenticated(req)
          ? applyAuthenticatedInMemoryLimit(req, res, next)
          : applyPublicInMemoryLimit(req, res, next);
      }

      if (isBearerAuthenticated(req)) {
        try {
          const keys = [
            getRateLimitKey(req),
            `ip:${req.ip || req.socket.remoteAddress || 'unknown'}`,
          ];
          for (const key of keys) {
            const dailyResult = await limiters.authDaily.limit(key);
            if (!dailyResult.success) {
              res.setHeader('Retry-After', Math.max(1, Math.ceil((dailyResult.reset - Date.now()) / 1000)));
              return next(dailyQuotaExceededError(dailyResult.reset, authDailyMax));
            }
            const minuteResult = await limiters.authMinute.limit(key);
            if (!minuteResult.success) {
              res.setHeader('Retry-After', Math.max(1, Math.ceil((minuteResult.reset - Date.now()) / 1000)));
              return next(rateLimitExceededError(minuteResult.reset));
            }
          }
          return next();
        } catch (err) {
          log('warn', 'Upstash authenticated rate limiter unavailable; falling back to in-memory limiting', {
            error: err instanceof Error ? err.message : String(err),
          });
          return applyAuthenticatedInMemoryBuckets(req, res, next);
        }
      }

      try {
        const identifier = getRateLimitKey(req);

        // 1. Check daily quota via Upstash
        const dailyResult = await limiters.daily.limit(identifier);
        if (!dailyResult.success) {
          const retrySec = Math.max(1, Math.ceil((dailyResult.reset - Date.now()) / 1000));
          res.setHeader('Retry-After', retrySec);
          return next(dailyQuotaExceededError(dailyResult.reset, dailyMax));
        }

        // 2. Check minute sliding window via Upstash
        const minuteResult = await limiters.minute.limit(identifier);
        res.setHeader('X-RateLimit-Limit', max);
        res.setHeader('X-RateLimit-Remaining', Math.max(0, minuteResult.remaining));
        res.setHeader('X-RateLimit-Reset', Math.ceil(minuteResult.reset / 1000));
        if (!minuteResult.success) {
          const retrySec = Math.max(1, Math.ceil((minuteResult.reset - Date.now()) / 1000));
          res.setHeader('Retry-After', retrySec);
          return next(rateLimitExceededError(minuteResult.reset));
        }
        next();
      } catch (err) {
        log('warn', 'Upstash rate limiter unavailable; falling back to in-memory limiting', {
          error: err instanceof Error ? err.message : String(err),
        });
        applyInMemoryLimit(req, res, next, max, windowMs, dailyMax, dailyWindowMs);
      }
    };
  }

  log('info', 'rate limiting via in-memory store', { max, windowMs, dailyMax, authMax, authWindowMs, authDailyMax, globalDailyMax });

  return (req, res, next) => {
    if (isBearerAuthenticated(req)) return applyAuthenticatedInMemoryLimit(req, res, next);
    applyPublicInMemoryLimit(req, res, next);
  };
}

/** Test helper — clears in-memory counters between tests. */
export function resetRateLimitStore(): void {
  hits.clear();
  dailyHits.clear();
}
