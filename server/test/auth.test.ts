import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import * as diagramModule from '../src/diagram';
import { resetRateLimitStore } from '../src/middleware/rateLimit';

describe('Server-Side Authentication & Abuse Controls', () => {
  beforeEach(() => {
    resetRateLimitStore();
    delete process.env.APP_API_KEY;
    delete process.env.SERVER_API_KEY;
    delete process.env.REQUIRE_PRIVATE_AUTH;
    delete process.env.RATE_LIMIT_MAX;
    delete process.env.DAILY_RATE_LIMIT_MAX;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetRateLimitStore();
    delete process.env.APP_API_KEY;
    delete process.env.SERVER_API_KEY;
    delete process.env.REQUIRE_PRIVATE_AUTH;
    delete process.env.RATE_LIMIT_MAX;
    delete process.env.DAILY_RATE_LIMIT_MAX;
  });

  it('allows access with valid server Bearer token', async () => {
    process.env.SERVER_API_KEY = 'secret-server-key';
    const app = createApp();
    vi.spyOn(diagramModule, 'generateDiagram').mockResolvedValue('flowchart TD\nA-->B');

    const res = await request(app)
      .post('/api/diagram')
      .set('Authorization', 'Bearer secret-server-key')
      .send({ text: 'A to B', diagramType: 'flowchart' });

    expect(res.status).toBe(200);
    expect(res.body.mermaid).toBe('flowchart TD\nA-->B');
  });

  it('rejects invalid server Bearer token', async () => {
    process.env.SERVER_API_KEY = 'secret-server-key';
    const app = createApp();

    const res = await request(app)
      .post('/api/diagram')
      .set('Authorization', 'Bearer wrong-key')
      .send({ text: 'A to B', diagramType: 'flowchart' });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('enforces REQUIRE_PRIVATE_AUTH by rejecting public X-API-Key and requiring Bearer', async () => {
    process.env.SERVER_API_KEY = 'secret-server-key';
    process.env.APP_API_KEY = 'public-client-key';
    process.env.REQUIRE_PRIVATE_AUTH = 'true';
    const app = createApp();

    // 1. Attempt using public frontend key should be rejected
    const publicRes = await request(app)
      .post('/api/diagram')
      .set('X-API-Key', 'public-client-key')
      .send({ text: 'A to B', diagramType: 'flowchart' });

    expect(publicRes.status).toBe(401);
    expect(publicRes.body.error).toContain('Private API authorization required');

    // 2. Attempt using server Bearer token succeeds
    vi.spyOn(diagramModule, 'generateDiagram').mockResolvedValue('flowchart TD\nA-->B');
    const privateRes = await request(app)
      .post('/api/diagram')
      .set('Authorization', 'Bearer secret-server-key')
      .send({ text: 'A to B', diagramType: 'flowchart' });

    expect(privateRes.status).toBe(200);
  });

  it('enforces daily IP quotas to prevent long-term abuse', async () => {
    process.env.DAILY_RATE_LIMIT_MAX = '2';
    process.env.RATE_LIMIT_MAX = '100'; // high per-minute to test daily quota independently
    resetRateLimitStore();

    const app = createApp();
    vi.spyOn(diagramModule, 'generateDiagram').mockResolvedValue('flowchart TD\nA-->B');
    const payload = { text: 'A to B', diagramType: 'flowchart' as const };

    await request(app).post('/api/diagram').send(payload);
    await request(app).post('/api/diagram').send(payload);
    const res = await request(app).post('/api/diagram').send(payload);

    expect(res.status).toBe(429);
    expect(res.body.code).toBe('DAILY_QUOTA_EXCEEDED');
    expect(res.body.error).toContain('Daily request quota exceeded');
    expect(res.headers['retry-after']).toBeDefined();
  });

  it('bypasses public IP rate limits and daily quotas for verified server Bearer token', async () => {
    process.env.SERVER_API_KEY = 'secret-server-key';
    process.env.RATE_LIMIT_MAX = '1';
    process.env.DAILY_RATE_LIMIT_MAX = '1';
    resetRateLimitStore();

    const app = createApp();
    vi.spyOn(diagramModule, 'generateDiagram').mockResolvedValue('flowchart TD\nA-->B');
    const payload = { text: 'A to B', diagramType: 'flowchart' as const };

    // Request 1 with Bearer
    const res1 = await request(app)
      .post('/api/diagram')
      .set('Authorization', 'Bearer secret-server-key')
      .send(payload);
    expect(res1.status).toBe(200);

    // Request 2 with Bearer (would have triggered 429 if not bypassed)
    const res2 = await request(app)
      .post('/api/diagram')
      .set('Authorization', 'Bearer secret-server-key')
      .send(payload);
    expect(res2.status).toBe(200);
  });
});
