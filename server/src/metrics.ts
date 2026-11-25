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

export interface ProviderRequestMetric {
  requests: number;
  errors: number;
  totalLatencyMs: number;
  lastLatencyMs: number;
  promptTokens: number;
  estimatedPromptTokens: number;
  completionTokens: number;
  requestedCompletionTokens: number;
  estimatedCostUsd: number;
  costEstimates: number;
  lastErrorCode: string | null;
}

const endpointStats = new Map<string, RequestMetric>();
const providerStats = new Map<string, ProviderRequestMetric>();
let totalRequests = 0;
let total5xxErrors = 0;
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
  if (statusCode >= 500) total5xxErrors += 1;

  const redis = getRedisClient();
  if (redis) {
    Promise.all([
      redis.incr('metrics:totalRequests'),
      statusCode >= 400 ? redis.incr('metrics:totalErrors') : Promise.resolve(),
      statusCode >= 500 ? redis.incr('metrics:5xxErrors') : Promise.resolve(),
      redis.sadd('metrics:endpoints', path),
      redis.hincrby(`metrics:endpoint:${path}`, 'count', 1),
      redis.hset(`metrics:endpoint:${path}`, { lastMs: Math.round(durationMs) }),
      statusCode >= 400 ? redis.hincrby(`metrics:endpoint:${path}`, 'errors', 1) : Promise.resolve(),
    ]).catch((err) => {
      log('warn', 'Failed to update durable metrics in Redis', { error: String(err) });
    });
  }
}

export function recordProviderRequest(input: {
  provider: 'openai' | 'ollama';
  operation: 'generate' | 'refine' | 'fix' | 'describe';
  durationMs: number;
  promptTokens: number;
  promptTokensEstimated: boolean;
  completionTokens?: number;
  requestedCompletionTokens: number;
  estimatedCostUsd: number | null;
  errorCode?: string;
}): void {
  const key = `${input.provider}.${input.operation}`;
  const stat = providerStats.get(key) ?? {
    requests: 0,
    errors: 0,
    totalLatencyMs: 0,
    lastLatencyMs: 0,
    promptTokens: 0,
    estimatedPromptTokens: 0,
    completionTokens: 0,
    requestedCompletionTokens: 0,
    estimatedCostUsd: 0,
    costEstimates: 0,
    lastErrorCode: null,
  };

  stat.requests += 1;
  stat.totalLatencyMs += input.durationMs;
  stat.lastLatencyMs = input.durationMs;
  stat.promptTokens += input.promptTokens;
  if (input.promptTokensEstimated) stat.estimatedPromptTokens += input.promptTokens;
  stat.completionTokens += input.completionTokens ?? 0;
  stat.requestedCompletionTokens += input.requestedCompletionTokens;
  if (input.estimatedCostUsd !== null) {
    stat.estimatedCostUsd += input.estimatedCostUsd;
    stat.costEstimates += 1;
  }
  if (input.errorCode) {
    stat.errors += 1;
    stat.lastErrorCode = input.errorCode;
  }
  providerStats.set(key, stat);

  const redis = getRedisClient();
  if (redis) {
    const redisKey = `metrics:provider:${input.provider}:${input.operation}`;
    const updates = [
      redis.hincrby(redisKey, 'requests', 1),
      redis.hincrby(redisKey, 'latencyMsTotal', Math.round(input.durationMs)),
      redis.hincrby(redisKey, 'promptTokens', input.promptTokens),
      redis.hincrby(redisKey, 'estimatedPromptTokens', input.promptTokensEstimated ? input.promptTokens : 0),
      redis.hincrby(redisKey, 'completionTokens', input.completionTokens ?? 0),
      redis.hincrby(redisKey, 'requestedCompletionTokens', input.requestedCompletionTokens),
    ];
    if (input.errorCode) updates.push(redis.hincrby(redisKey, 'errors', 1));
    if (input.estimatedCostUsd !== null) {
      updates.push(redis.hincrby(redisKey, 'estimatedCostMicrosUsd', Math.round(input.estimatedCostUsd * 1_000_000)));
      updates.push(redis.hincrby(redisKey, 'costEstimates', 1));
    }
    Promise.all([
      ...updates,
      redis.hset(redisKey, {
        lastLatencyMs: Math.round(input.durationMs),
        lastErrorCode: input.errorCode ?? '',
      }),
    ]).catch((err) => {
      log('warn', 'Failed to persist provider metrics in Redis', { error: String(err) });
    });
  }
}

export function getProviderMetrics(): Record<string, ProviderRequestMetric> {
  return Object.fromEntries(providerStats);
}

export async function getDurableProviderMetrics(): Promise<Record<string, ProviderRequestMetric> | null> {
  const redis = getRedisClient();
  if (!redis) return null;

  const pairs = (['openai', 'ollama'] as const).flatMap((provider) =>
    (['generate', 'refine', 'fix', 'describe'] as const).map((operation) => ({ provider, operation })),
  );

  try {
    const rows = await Promise.all(pairs.map(async ({ provider, operation }) => {
      const data = await redis.hgetall(`metrics:provider:${provider}:${operation}`);
      const raw = (data ?? {}) as Record<string, string | number>;
      const numberField = (name: string) => Number(raw[name] ?? 0) || 0;
      const requests = numberField('requests');
      return [
        `${provider}.${operation}`,
        {
          requests,
          errors: numberField('errors'),
          totalLatencyMs: numberField('latencyMsTotal'),
          lastLatencyMs: numberField('lastLatencyMs'),
          promptTokens: numberField('promptTokens'),
          estimatedPromptTokens: numberField('estimatedPromptTokens'),
          completionTokens: numberField('completionTokens'),
          requestedCompletionTokens: numberField('requestedCompletionTokens'),
          estimatedCostUsd: numberField('estimatedCostMicrosUsd') / 1_000_000,
          costEstimates: numberField('costEstimates'),
          lastErrorCode: typeof raw.lastErrorCode === 'string' && raw.lastErrorCode ? raw.lastErrorCode : null,
        } satisfies ProviderRequestMetric,
      ] as const;
    }));
    return Object.fromEntries(rows.filter(([, metric]) => metric.requests > 0));
  } catch (err) {
    log('warn', 'Failed to read durable provider metrics from Redis', { error: String(err) });
    return null;
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
  total5xxErrors: number;
  fallbackCount: number;
  lastError: LastError | null;
  endpoints: Record<string, RequestMetric>;
} | null> {
  const redis = getRedisClient();
  if (!redis) return null;

  try {
    const [reqs, errs, serverErrs, fallbacks, lastErrRaw, endpointPaths] = await Promise.all([
      redis.get<number>('metrics:totalRequests'),
      redis.get<number>('metrics:totalErrors'),
      redis.get<number>('metrics:5xxErrors'),
      redis.get<number>('metrics:fallbackCount'),
      redis.get<string>('metrics:lastError'),
      redis.smembers('metrics:endpoints'),
    ]);

    let parsedLastError: LastError | null = null;
    if (lastErrRaw) {
      parsedLastError = typeof lastErrRaw === 'string' ? JSON.parse(lastErrRaw) : (lastErrRaw as LastError);
    }

    const endpointRows = await Promise.all(((endpointPaths ?? []) as string[]).map(async (path) => {
      const data = await redis.hgetall(`metrics:endpoint:${path}`);
      const raw = (data ?? {}) as Record<string, string | number>;
      return [path, {
        count: Number(raw.count ?? 0) || 0,
        errors: Number(raw.errors ?? 0) || 0,
        lastMs: Number(raw.lastMs ?? 0) || 0,
      }] as const;
    }));

    return {
      totalRequests: reqs ?? totalRequests,
      totalErrors: errs ?? 0,
      total5xxErrors: serverErrs ?? 0,
      fallbackCount: fallbacks ?? fallbackCount,
      lastError: parsedLastError ?? lastError,
      endpoints: Object.fromEntries(endpointRows),
    };
  } catch (err) {
    log('warn', 'Failed to fetch durable metrics from Redis', { error: String(err) });
    return null;
  }
}

export function getMetrics() {
  return {
    totalRequests,
    totalErrors: [...endpointStats.values()].reduce((sum, stat) => sum + stat.errors, 0),
    total5xxErrors,
    fallbackCount,
    lastError,
    endpoints: Object.fromEntries(endpointStats),
    providers: Object.fromEntries(providerStats),
    durableConfigured: Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN),
    durableStore: false,
  };
}

export async function getMetricsSnapshot() {
  const local = getMetrics();
  const durable = await getDurableMetrics();
  if (!durable) return { ...local, durableStore: false };
  return { ...local, ...durable, durableStore: true };
}

export function getPrometheusMetrics(m = getMetrics()): string {
  const lines: string[] = [
    '# HELP http_requests_total Total number of HTTP requests processed.',
    '# TYPE http_requests_total counter',
    `http_requests_total ${m.totalRequests}`,
    '',
    '# HELP http_requests_errors_total Total number of HTTP requests with a 4xx or 5xx response.',
    '# TYPE http_requests_errors_total counter',
    `http_requests_errors_total ${m.totalErrors}`,
    '',
    '# HELP http_requests_5xx_total Total number of HTTP requests with a 5xx response.',
    '# TYPE http_requests_5xx_total counter',
    `http_requests_5xx_total ${m.total5xxErrors}`,
    '',
    '# HELP llm_fallback_generations_total Total number of diagram generations served by local fallback parser.',
    '# TYPE llm_fallback_generations_total counter',
    `llm_fallback_generations_total ${m.fallbackCount}`,
    '',
    '# HELP llm_chart_metrics_store_durable Whether the HTTP and fallback counters are read from shared Redis.',
    '# TYPE llm_chart_metrics_store_durable gauge',
    `llm_chart_metrics_store_durable ${m.durableStore ? 1 : 0}`,
    '',
  ];

  for (const [path, stat] of Object.entries(m.endpoints)) {
    const sanitizedPath = path
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\r\n?|\n/g, '\\n');
    lines.push(`http_endpoint_requests_total{path="${sanitizedPath}"} ${stat.count}`);
    lines.push(`http_endpoint_errors_total{path="${sanitizedPath}"} ${stat.errors}`);
    lines.push(`http_endpoint_last_duration_ms{path="${sanitizedPath}"} ${stat.lastMs}`);
  }

  lines.push(
    '',
    '# HELP llm_provider_requests_total Completed or failed LLM provider requests.',
    '# TYPE llm_provider_requests_total counter',
  );
  for (const [label, stat] of providerStats.entries()) {
    const [provider, operation] = label.split('.');
    const labels = `provider="${provider}",operation="${operation}"`;
    lines.push(`llm_provider_requests_total{${labels}} ${stat.requests}`);
    lines.push(`llm_provider_errors_total{${labels}} ${stat.errors}`);
    lines.push(`llm_provider_request_duration_ms_total{${labels}} ${stat.totalLatencyMs}`);
    lines.push(`llm_provider_prompt_tokens_total{${labels}} ${stat.promptTokens}`);
    lines.push(`llm_provider_estimated_prompt_tokens_total{${labels}} ${stat.estimatedPromptTokens}`);
    lines.push(`llm_provider_completion_tokens_total{${labels}} ${stat.completionTokens}`);
    lines.push(`llm_provider_requested_completion_tokens_total{${labels}} ${stat.requestedCompletionTokens}`);
    if (stat.costEstimates > 0) {
      lines.push(`llm_provider_estimated_cost_usd_total{${labels}} ${stat.estimatedCostUsd}`);
    }
  }

  return lines.join('\n') + '\n';
}

export function resetMetrics(): void {
  endpointStats.clear();
  providerStats.clear();
  totalRequests = 0;
  total5xxErrors = 0;
  fallbackCount = 0;
  lastError = null;
}
