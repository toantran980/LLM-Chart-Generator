import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { getPrometheusMetrics, recordError, recordFallback, recordRequest, resetMetrics } from '../src/metrics';
import { getRateLimitKey, verifyUpstashConnection } from '../src/middleware/rateLimit';

describe('Durable Metrics, Prometheus & Upstash Diagnostics', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    resetMetrics();
  });

  afterEach(() => {
    process.env = originalEnv;
    resetMetrics();
    vi.restoreAllMocks();
  });

  it('formats metrics in valid Prometheus text format', () => {
    recordRequest('/api/diagram', 200, 150);
    recordRequest('/api/diagram', 500, 20);
    recordFallback();

    const output = getPrometheusMetrics();
    expect(output).toContain('# HELP http_requests_total');
    expect(output).toContain('# TYPE http_requests_total counter');
    expect(output).toContain('http_requests_total 2');
    expect(output).toContain('llm_fallback_generations_total 1');
    expect(output).toContain('http_endpoint_requests_total{path="/api/diagram"} 2');
    expect(output).toContain('http_endpoint_errors_total{path="/api/diagram"} 1');
  });

  it('GET /metrics serves Prometheus metrics over HTTP', async () => {
    const app = createApp();
    const res = await request(app).get('/metrics');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.text).toContain('http_requests_total');
  });

  it('verifyUpstashConnection reports in-memory mode when credentials unset', async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;

    const status = await verifyUpstashConnection();
    expect(status.store).toBe('in-memory');
    expect(status.configured).toBe(false);
    expect(status.ready).toBe(true);
  });

  it('getRateLimitKey respects verified user/bearer identity over raw IP', () => {
    const fakeIpReq = {
      ip: '192.168.1.1',
      socket: { remoteAddress: '192.168.1.1' },
      header: () => undefined,
    } as any;
    expect(getRateLimitKey(fakeIpReq)).toBe('ip:192.168.1.1');

    const authReq = {
      ...fakeIpReq,
      auth: { type: 'bearer', identity: 'enterprise-client-1' },
    } as any;
    expect(getRateLimitKey(authReq)).toBe('auth:enterprise-client-1');

    const userReq = {
      ...authReq,
      header: (name: string) => (name.toLowerCase() === 'x-user-id' ? 'user-42' : undefined),
    } as any;
    expect(getRateLimitKey(userReq)).toBe('user:user-42');
  });
});
