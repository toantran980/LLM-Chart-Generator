import { once } from 'node:events';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// This bounded smoke load runs only against the local parser. It does not load
// the repository .env file or contact any external provider/database/Redis.
for (const name of [
  'OPENAI_API_KEY',
  'OPENAI_API_URL',
  'POSTGRES_URL',
  'DATABASE_URL',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'APP_API_KEY',
  'SERVER_API_KEY',
  'SENTRY_DSN',
]) delete process.env[name];

Object.assign(process.env, {
  NODE_ENV: 'test',
  LLM_PROVIDER: 'fallback',
  RATE_LIMIT_MAX: '20',
  RATE_LIMIT_WINDOW_MS: '60000',
  DAILY_RATE_LIMIT_MAX: '200',
  GLOBAL_DAILY_RATE_LIMIT_MAX: '1000',
  CLEANUP_ENABLED: 'false',
});

const appEntry = path.resolve('server/dist/server/src/app.js');
const appModule = await import(pathToFileURL(appEntry).href);
const createApp = appModule.createApp ?? appModule.default?.createApp;
if (!createApp) throw new Error(`Could not load createApp from ${appEntry}; build the server first.`);

async function listen(app) {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Local test server did not bind to a TCP port.');
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

const loadServer = await listen(createApp());
let rateServer;

try {
  const requestCount = 40;
  const concurrency = 10;
  const durations = new Array(requestCount);
  const statuses = new Array(requestCount);
  let cursor = 0;

  async function worker() {
    while (cursor < requestCount) {
      const index = cursor++;
      const started = performance.now();
      const response = await fetch(`${loadServer.baseUrl}/api/diagram`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Four stable caller IPs keep this smoke run under the default
          // per-IP limit while exercising ten simultaneous requests.
          'X-Forwarded-For': `198.51.100.${Math.floor(index / 10) + 1}`,
        },
        body: JSON.stringify({
          text: `Process bounded local load request ${index}: input, transform, output.`,
          diagramType: 'flowchart',
        }),
      });
      durations[index] = performance.now() - started;
      statuses[index] = response.status;
      if (response.status !== 200) {
        const body = await response.text();
        throw new Error(`Load request ${index} returned ${response.status}: ${body}`);
      }
      const body = await response.json();
      if (typeof body.mermaid !== 'string' || !body.mermaid.trim()) {
        throw new Error(`Load request ${index} returned no Mermaid diagram.`);
      }
    }
  }

  const loadStarted = performance.now();
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const elapsedMs = performance.now() - loadStarted;
  const sorted = [...durations].sort((a, b) => a - b);
  const p50Ms = sorted[Math.floor((sorted.length - 1) * 0.50)];
  const p95Ms = sorted[Math.floor((sorted.length - 1) * 0.95)];

  const invalidResponse = await fetch(`${loadServer.baseUrl}/api/diagram`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.99' },
    body: JSON.stringify({ text: '', diagramType: 'flowchart' }),
  });
  if (invalidResponse.status !== 400) {
    throw new Error(`Expected validation failure 400; received ${invalidResponse.status}.`);
  }

  process.env.RATE_LIMIT_MAX = '1';
  rateServer = await listen(createApp());
  const rateHeaders = {
    'Content-Type': 'application/json',
    'X-Forwarded-For': '198.51.100.200',
  };
  const rateBody = JSON.stringify({ text: 'A to B', diagramType: 'flowchart' });
  const first = await fetch(`${rateServer.baseUrl}/api/diagram`, {
    method: 'POST', headers: rateHeaders, body: rateBody,
  });
  const second = await fetch(`${rateServer.baseUrl}/api/diagram`, {
    method: 'POST', headers: rateHeaders, body: rateBody,
  });
  if (first.status !== 200 || second.status !== 429) {
    throw new Error(`Expected rate-limit responses 200 then 429; received ${first.status} then ${second.status}.`);
  }

  console.log(JSON.stringify({
    scope: 'local fallback parser only; no provider, database, Redis, or production traffic',
    requests: requestCount,
    concurrency,
    successfulResponses: statuses.filter((status) => status === 200).length,
    elapsedMs: Math.round(elapsedMs),
    throughputPerSecond: Number((requestCount / (elapsedMs / 1000)).toFixed(1)),
    responseLatencyMs: { p50: Math.round(p50Ms), p95: Math.round(p95Ms) },
    failureChecks: { validation: invalidResponse.status, rateLimit: [first.status, second.status] },
  }, null, 2));
} finally {
  await Promise.all([loadServer.server, rateServer?.server].filter(Boolean).map((server) =>
    new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  ));
}
