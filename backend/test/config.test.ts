import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { validateStartupConfig } from '../src/config';

describe('Config Validation', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('validates a correct default configuration', () => {
    process.env.LLM_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.PORT = '4173';

    const result = validateStartupConfig();
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('detects invalid PORT values', () => {
    process.env.PORT = 'invalid-port';
    const result = validateStartupConfig();
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('PORT must be a valid integer'))).toBe(true);
  });

  it('warns when POSTGRES_URL and DATABASE_URL conflict', () => {
    process.env.POSTGRES_URL = 'postgresql://user:pass@host1/db';
    process.env.DATABASE_URL = 'postgresql://user:pass@host2/db';

    const result = validateStartupConfig();
    expect(result.warnings.some((w) => w.includes('Both POSTGRES_URL and DATABASE_URL are set'))).toBe(true);
  });

  it('flags invalid LLM_PROVIDER', () => {
    process.env.LLM_PROVIDER = 'anthropic';

    const result = validateStartupConfig();
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Invalid LLM_PROVIDER'))).toBe(true);
  });

  it('warns when OpenAI key is missing under openai provider', () => {
    process.env.LLM_PROVIDER = 'openai';
    delete process.env.OPENAI_API_KEY;

    const result = validateStartupConfig();
    expect(result.warnings.some((w) => w.includes('OPENAI_API_KEY is not set'))).toBe(true);
  });

  it('warns when Upstash Redis is partially configured', () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://upstash.io';
    delete process.env.UPSTASH_REDIS_REST_TOKEN;

    const result = validateStartupConfig();
    expect(result.warnings.some((w) => w.includes('UPSTASH_REDIS_REST_URL is configured without UPSTASH_REDIS_REST_TOKEN'))).toBe(true);
  });

  it('warns on invalid RATE_LIMIT_MAX', () => {
    process.env.RATE_LIMIT_MAX = '-5';

    const result = validateStartupConfig();
    expect(result.warnings.some((w) => w.includes('RATE_LIMIT_MAX must be a positive number'))).toBe(true);
  });
});
