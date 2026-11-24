import { log } from './logger';

export interface AppConfig {
  port: number;
  nodeEnv: string;
  allowedOrigin?: string;
  databaseUrl: string | null;
  llmProvider: 'openai' | 'ollama' | 'fallback';
  openaiApiKey?: string;
  openaiApiUrl?: string;
  ollamaUrl?: string;
  ollamaModel?: string;
  llmTimeoutMs: number;
  appApiKey?: string;
  serverApiKey?: string;
  requirePrivateAuth?: boolean;
  upstashRedisRestUrl?: string;
  upstashRedisRestToken?: string;
  sentryDsn?: string;
  rateLimitMax: number;
  rateLimitWindowMs: number;
  dailyRateLimitMax: number;
}

export interface ConfigValidationResult {
  valid: boolean;
  warnings: string[];
  errors: string[];
}

export function validateStartupConfig(): ConfigValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  // 1. Validate PORT
  if (process.env.PORT) {
    const port = Number(process.env.PORT);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      errors.push(`PORT must be a valid integer between 1 and 65535; received "${process.env.PORT}".`);
    }
  }

  // 2. Validate and canonicalize Database URL
  const postgresUrl = process.env.POSTGRES_URL?.trim();
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (postgresUrl && databaseUrl && postgresUrl !== databaseUrl) {
    warnings.push(
      'Both POSTGRES_URL and DATABASE_URL are set with differing values. POSTGRES_URL is canonical and takes precedence.',
    );
  }

  // 3. Validate LLM Provider configuration
  const provider = process.env.LLM_PROVIDER?.trim() || 'openai';
  if (!['openai', 'ollama', 'fallback'].includes(provider)) {
    errors.push(`Invalid LLM_PROVIDER "${provider}"; expected "openai", "ollama", or "fallback".`);
  } else if (provider === 'openai' && !process.env.OPENAI_API_KEY) {
    warnings.push(
      'LLM_PROVIDER is "openai" but OPENAI_API_KEY is not set. Diagram generation will fall back to local parser, and refinement/repair endpoints will be unavailable.',
    );
  } else if (provider === 'ollama') {
    const ollamaUrl = process.env.OLLAMA_URL?.trim();
    if (ollamaUrl) {
      try {
        new URL(ollamaUrl);
      } catch {
        warnings.push(`OLLAMA_URL "${ollamaUrl}" is not a valid URL.`);
      }
    }
  }

  // 4. Validate Upstash Redis configuration
  const upstashUrl = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (upstashUrl && !upstashToken) {
    warnings.push('UPSTASH_REDIS_REST_URL is configured without UPSTASH_REDIS_REST_TOKEN. Falling back to in-memory rate limiting.');
  } else if (!upstashUrl && upstashToken) {
    warnings.push('UPSTASH_REDIS_REST_TOKEN is configured without UPSTASH_REDIS_REST_URL. Falling back to in-memory rate limiting.');
  }

  // 5. Validate Rate Limiting
  if (process.env.RATE_LIMIT_MAX) {
    const max = Number(process.env.RATE_LIMIT_MAX);
    if (isNaN(max) || max <= 0) {
      warnings.push(`RATE_LIMIT_MAX must be a positive number; received "${process.env.RATE_LIMIT_MAX}". Using default.`);
    }
  }
  if (process.env.RATE_LIMIT_WINDOW_MS) {
    const windowMs = Number(process.env.RATE_LIMIT_WINDOW_MS);
    if (isNaN(windowMs) || windowMs <= 0) {
      warnings.push(`RATE_LIMIT_WINDOW_MS must be a positive number; received "${process.env.RATE_LIMIT_WINDOW_MS}". Using default.`);
    }
  }
  if (process.env.DAILY_RATE_LIMIT_MAX) {
    const dailyMax = Number(process.env.DAILY_RATE_LIMIT_MAX);
    if (isNaN(dailyMax) || dailyMax <= 0) {
      warnings.push(`DAILY_RATE_LIMIT_MAX must be a positive number; received "${process.env.DAILY_RATE_LIMIT_MAX}". Using default.`);
    }
  }
  for (const name of [
    'AUTH_RATE_LIMIT_MAX',
    'AUTH_RATE_LIMIT_WINDOW_MS',
    'AUTH_DAILY_RATE_LIMIT_MAX',
    'GLOBAL_DAILY_RATE_LIMIT_MAX',
  ]) {
    const raw = process.env[name];
    if (raw && (!Number.isInteger(Number(raw)) || Number(raw) <= 0)) {
      warnings.push(`${name} must be a positive integer; received "${raw}". Using default.`);
    }
  }

  // 6. Validate Server Auth configuration
  if (process.env.REQUIRE_PRIVATE_AUTH === 'true' && !process.env.SERVER_API_KEY) {
    errors.push('REQUIRE_PRIVATE_AUTH is set to "true" but SERVER_API_KEY is not configured.');
  }

  // 7. Validate Cleanup configuration
  if (process.env.CLEANUP_INTERVAL_HOURS) {
    const hours = Number(process.env.CLEANUP_INTERVAL_HOURS);
    if (isNaN(hours) || hours <= 0) {
      warnings.push(`CLEANUP_INTERVAL_HOURS must be a positive number; received "${process.env.CLEANUP_INTERVAL_HOURS}". Using default.`);
    }
  }
  if (process.env.CLEANUP_RETENTION_DAYS) {
    const days = Number(process.env.CLEANUP_RETENTION_DAYS);
    if (isNaN(days) || days <= 0) {
      warnings.push(`CLEANUP_RETENTION_DAYS must be a positive number; received "${process.env.CLEANUP_RETENTION_DAYS}". Using default.`);
    }
  }

  // Emit logs
  for (const warning of warnings) {
    log('warn', `Startup configuration warning: ${warning}`);
  }
  for (const error of errors) {
    log('error', `Startup configuration error: ${error}`);
  }

  return {
    valid: errors.length === 0,
    warnings,
    errors,
  };
}
