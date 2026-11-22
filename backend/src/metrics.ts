import { Redis } from '@upstash/redis';
import { log } from './logger';

export interface RequestMetric {
  count: number;
  errors: number;
  lastMs: number;
}

export interface LastError {
  message: string;
  code: string;
  statusCode: number;
  path: string;
  at: string;
}

const endpointStats = new Map<string, RequestMetric>();
let totalRequests = 0;
let fallbackCount = 0;
let lastError: LastError | null = null;

function getRedisClient(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  return new Redis({ url, token });
}

export function recordRequest(path: string, statusCode: number, durationMs: number): void {
  const stat = endpointStats.get(path) ?? { count: 0, errors: 0, lastMs: 0 };
  stat.count += 1;
  stat.lastMs = durationMs;
  if (statusCode >= 400) stat.errors += 1;
  endpointStats.set(path, stat);
  totalRequests += 1;

  const redis = getRedisClient();
  if (redis) {
    Promise.all([
      redis.incr('metrics:totalRequests'),
      statusCode >= 400 ? redis.incr('metrics:totalErrors') : Promise.resolve(),
      statusCode >= 500 ? redis.incr('metrics:5xxErrors') : Promise.resolve(),
      redis.hincrby(`metrics:endpoint:${path}`, 'count', 1),
      statusCode >= 400 ? redis.hincrby(`metrics:endpoint:${path}`, 'errors', 1) : Promise.resolve(),
    ]).catch((err) => {
      log('warn', 'Failed to update durable metrics in Redis', { error: String(err) });
    });
  }
}

export function recordFallback(): void {
  fallbackCount += 1;

  const redis = getRedisClient();
  if (redis) {
    redis.incr('metrics:fallbackCount').catch((err) => {
      log('warn', 'Failed to update durable fallbackCount in Redis', { error: String(err) });
    });
  }
}

export function recordError(err: { message?: string; code?: string; statusCode?: number; path?: string }): void {
  lastError = {
    message: err.message ?? 'Unknown',
    code: err.code ?? 'INTERNAL_ERROR',
    statusCode: err.statusCode ?? 500,
    path: err.path ?? '/unknown',
    at: new Date().toISOString(),
  };

  const redis = getRedisClient();
  if (redis) {
    redis.set('metrics:lastError', JSON.stringify(lastError), { ex: 86400 }).catch((e) => {
      log('warn', 'Failed to persist lastError in Redis', { error: String(e) });
    });
  }
}

export async function getDurableMetrics(): Promise<{
  totalRequests: number;
  totalErrors: number;
  fallbackCount: number;
  lastError: LastError | null;
} | null> {
  const redis = getRedisClient();
  if (!redis) return null;

  try {
    const [reqs, errs, fallbacks, lastErrRaw] = await Promise.all([
      redis.get<number>('metrics:totalRequests'),
      redis.get<number>('metrics:totalErrors'),
      redis.get<number>('metrics:fallbackCount'),
      redis.get<string>('metrics:lastError'),
    ]);

    let parsedLastError: LastError | null = null;
    if (lastErrRaw) {
      parsedLastError = typeof lastErrRaw === 'string' ? JSON.parse(lastErrRaw) : (lastErrRaw as LastError);
    }

    return {
      totalRequests: reqs ?? totalRequests,
      totalErrors: errs ?? 0,
      fallbackCount: fallbacks ?? fallbackCount,
      lastError: parsedLastError ?? lastError,
    };
  } catch (err) {
    log('warn', 'Failed to fetch durable metrics from Redis', { error: String(err) });
    return null;
  }
}

export function getMetrics() {
  return {
    totalRequests,
    fallbackCount,
    lastError,
    endpoints: Object.fromEntries(endpointStats),
    durableStore: Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN),
  };
}

export function getPrometheusMetrics(): string {
  const m = getMetrics();
  const lines: string[] = [
    '# HELP http_requests_total Total number of HTTP requests processed.',
    '# TYPE http_requests_total counter',
    `http_requests_total ${m.totalRequests}`,
    '',
    '# HELP llm_fallback_generations_total Total number of diagram generations served by local fallback parser.',
    '# TYPE llm_fallback_generations_total counter',
    `llm_fallback_generations_total ${m.fallbackCount}`,
    '',
  ];

  for (const [path, stat] of endpointStats.entries()) {
    const sanitizedPath = path.replace(/"/g, '\\"');
    lines.push(`http_endpoint_requests_total{path="${sanitizedPath}"} ${stat.count}`);
    lines.push(`http_endpoint_errors_total{path="${sanitizedPath}"} ${stat.errors}`);
    lines.push(`http_endpoint_last_duration_ms{path="${sanitizedPath}"} ${stat.lastMs}`);
  }

  return lines.join('\n') + '\n';
}

export function resetMetrics(): void {
  endpointStats.clear();
  totalRequests = 0;
  fallbackCount = 0;
  lastError = null;
}
