#!/usr/bin/env node

/**
 * End-to-end container smoke test script.
 * Verifies that both frontend (Nginx) and backend (Express) containers are
 * functioning correctly and can communicate through the reverse proxy.
 */

const BACKEND_URL = (process.env.SMOKE_BACKEND_URL || 'http://127.0.0.1:4000').replace(/\/+$/, '');
const FRONTEND_URL = (process.env.SMOKE_FRONTEND_URL || 'http://127.0.0.1:80').replace(/\/+$/, '');
const MAX_ATTEMPTS = 30;
const DELAY_MS = 2000;

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForEndpoint(url, expectedStatus = 200, maxAttempts = MAX_ATTEMPTS) {
  process.stdout.write(`Waiting for ${url} to be ready... `);
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status === expectedStatus) {
        console.log(`[READY] (attempt ${attempt})`);
        return await res.json().catch(() => null);
      }
    } catch {
      // transient connection failure during container boot
    }
    await sleep(DELAY_MS);
  }
  console.log(`[TIMEOUT]`);
  throw new Error(`Timed out waiting for ${url} after ${maxAttempts * (DELAY_MS / 1000)}s`);
}

async function runSmokeTests() {
  console.log('====================================================');
  console.log(' Starting Container Smoke Tests');
  console.log(` Backend:  ${BACKEND_URL}`);
  console.log(` Frontend: ${FRONTEND_URL}`);
  console.log('====================================================\n');

  // 1. Probe Backend /ready
  console.log('1. Probing Backend /ready...');
  const readyData = await waitForEndpoint(`${BACKEND_URL}/ready`, 200);
  if (!readyData || readyData.ok !== true) {
    throw new Error(`Backend /ready reported unhealthy state: ${JSON.stringify(readyData)}`);
  }
  console.log('   [PASS] Backend /ready is healthy.\n');

  // 2. Probe Backend /health
  console.log('2. Probing Backend /health...');
  const healthRes = await fetch(`${BACKEND_URL}/health`);
  if (!healthRes.ok) {
    throw new Error(`Backend /health returned status ${healthRes.status}`);
  }
  const healthData = await healthRes.json();
  if (!healthData || healthData.ok !== true || typeof healthData.uptime !== 'number') {
    throw new Error(`Invalid /health response: ${JSON.stringify(healthData)}`);
  }
  console.log(`   [PASS] Backend /health reports uptime: ${healthData.uptime}s, fallback: ${healthData.fallback}.\n`);

  // 3. Probe Frontend HTML
  console.log('3. Probing Frontend static serving...');
  const frontendRes = await fetch(`${FRONTEND_URL}/`);
  if (!frontendRes.ok) {
    throw new Error(`Frontend returned status ${frontendRes.status}`);
  }
  const html = await frontendRes.text();
  if (!html.includes('<!doctype html') && !html.includes('<!DOCTYPE html')) {
    throw new Error('Frontend response does not appear to be valid HTML');
  }
  console.log('   [PASS] Frontend Nginx served index.html successfully.\n');

  // 4. Test Diagram Generation via Frontend Proxy
  console.log('4. Testing diagram generation via Frontend proxy (POST /api/diagram)...');
  const genRes = await fetch(`${FRONTEND_URL}/api/diagram`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: 'User requests login -> System validates -> Dashboard loaded',
      diagramType: 'flowchart',
    }),
  });
  if (!genRes.ok) {
    const errorText = await genRes.text();
    throw new Error(`POST /api/diagram returned ${genRes.status}: ${errorText}`);
  }
  const genData = await genRes.json();
  if (!genData.mermaid || typeof genData.mermaid !== 'string') {
    throw new Error(`Expected mermaid diagram in response, got: ${JSON.stringify(genData)}`);
  }
  console.log('   [PASS] Diagram generated successfully through Nginx reverse proxy.\n');

  // 5. Test Diagram Sharing & Retrieval via Frontend Proxy
  console.log('5. Testing diagram sharing & retrieval (POST /api/diagrams/share & GET /api/diagrams/:id)...');
  const shareRes = await fetch(`${FRONTEND_URL}/api/diagrams/share`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Smoke Test Diagram',
      mermaid: 'flowchart LR\n  A[Start] --> B[Finish]',
      diagramType: 'flowchart',
      direction: 'LR',
    }),
  });
  if (!shareRes.ok) {
    const errorText = await shareRes.text();
    throw new Error(`POST /api/diagrams/share returned ${shareRes.status}: ${errorText}`);
  }
  const shareData = await shareRes.json();
  if (!shareData.id) {
    throw new Error(`Share response missing diagram id: ${JSON.stringify(shareData)}`);
  }

  // Retrieve shared diagram
  const getRes = await fetch(`${FRONTEND_URL}/api/diagrams/${shareData.id}`);
  if (!getRes.ok) {
    throw new Error(`GET /api/diagrams/${shareData.id} returned status ${getRes.status}`);
  }
  const getData = await getRes.json();
  if (getData.id !== shareData.id || getData.title !== 'Smoke Test Diagram') {
    throw new Error(`Retrieved diagram mismatch: ${JSON.stringify(getData)}`);
  }
  console.log(`   [PASS] Shared diagram saved (id: ${shareData.id}) and retrieved successfully.\n`);

  console.log('====================================================');
  console.log(' ALL CONTAINER SMOKE TESTS PASSED SUCCESSFULLY! ');
  console.log('====================================================');
}

runSmokeTests().catch((err) => {
  console.error('\n[SMOKE TEST FAILED]');
  console.error(err.message || err);
  process.exit(1);
});
