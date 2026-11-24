import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import request from 'supertest';
import { createApp } from '../src/app';
import { checkLlmProviderHealth, resetLlmHealthCache } from '../src/llm';

describe('Bounded LLM Provider Probes', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.POSTGRES_URL;
    delete process.env.DATABASE_URL;
    delete process.env.OPENAI_API_KEY;
    delete process.env.LLM_PROVIDER;
    delete process.env.OLLAMA_URL;
    resetLlmHealthCache();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
    resetLlmHealthCache();
    vi.restoreAllMocks();
  });

  it('probes fallback mode safely with 0 cost', async () => {
    process.env.LLM_PROVIDER = 'fallback';
    const status = await checkLlmProviderHealth();

    expect(status.provider).toBe('fallback');
    expect(status.configured).toBe(false);
    expect(status.ready).toBe(true);
    expect(status.cached).toBe(false);
  });

  it('reports ready in unconfigured OpenAI mode (fallback parser active)', async () => {
    process.env.LLM_PROVIDER = 'openai';
    delete process.env.OPENAI_API_KEY;

    const status = await checkLlmProviderHealth();
    expect(status.provider).toBe('openai');
    expect(status.configured).toBe(false);
    expect(status.ready).toBe(true);
  });

  it('probes OpenAI via zero-token GET /v1/models when configured', async () => {
    process.env.LLM_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'sk-test-key';

    const getSpy = vi.spyOn(axios, 'get').mockResolvedValue({
      status: 200,
      data: { data: [{ id: 'gpt-4o-mini' }] },
    });

    const status = await checkLlmProviderHealth();

    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(getSpy.mock.calls[0][0]).toContain('/v1/models');
    expect(getSpy.mock.calls[0][1]?.headers?.Authorization).toBe('Bearer sk-test-key');
    expect(status.provider).toBe('openai');
    expect(status.configured).toBe(true);
    expect(status.ready).toBe(true);
    expect(status.cached).toBe(false);
  });

  it('caches probe results within TTL to avoid excess network requests', async () => {
    process.env.LLM_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'sk-test-key';

    const getSpy = vi.spyOn(axios, 'get').mockResolvedValue({ status: 200, data: {} });

    const status1 = await checkLlmProviderHealth();
    expect(status1.cached).toBe(false);

    const status2 = await checkLlmProviderHealth();
    expect(status2.cached).toBe(true);
    expect(getSpy).toHaveBeenCalledTimes(1); // second call was served from cache

    const status3 = await checkLlmProviderHealth({ force: true });
    expect(status3.cached).toBe(false);
    expect(getSpy).toHaveBeenCalledTimes(2); // forced bypass
  });

  it('probes Ollama via zero-inference GET /api/version when configured', async () => {
    process.env.LLM_PROVIDER = 'ollama';
    process.env.OLLAMA_URL = 'http://127.0.0.1:11434';

    const getSpy = vi.spyOn(axios, 'get').mockResolvedValue({
      status: 200,
      data: { version: '0.5.1' },
    });

    const status = await checkLlmProviderHealth();

    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(getSpy.mock.calls[0][0]).toBe('http://127.0.0.1:11434/api/version');
    expect(status.provider).toBe('ollama');
    expect(status.configured).toBe(true);
    expect(status.ready).toBe(true);
  });

  it('GET /ready returns 503 when configured LLM provider is unreachable', async () => {
    process.env.LLM_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'sk-test-key';

    vi.spyOn(axios, 'get').mockRejectedValue(new Error('Connection timeout to api.openai.com'));

    const app = createApp();
    const res = await request(app).get('/ready');

    expect(res.status).toBe(503);
    expect(res.body.ok).toBe(false);
    expect(res.body.llm.configured).toBe(true);
    expect(res.body.llm.ready).toBe(false);
    expect(res.body.llm.error).toContain('Connection timeout');
  });
});
