# Deployment Readiness Issues

This file lists the remaining deployment work. Code-level items already completed are tracked in the repository history; production settings that require provider dashboards remain open until verified there.

## Deployment and reliability

- [ ] Configure Upstash in production and verify shared rate limits across at least two running server instances. `/ready` checks connectivity, but does not prove multi-instance behavior.
- [ ] Add support for Render Key Value's standard `REDIS_URL`; the current rate limiter supports Upstash REST URL/token credentials only.
- [ ] Run a controlled hosted load and failure test to measure capacity with the selected Render, Neon, Redis, and LLM plans. Local fallback checks do not establish hosted capacity.

## Security and abuse controls

- [ ] Decide whether direct public API access is acceptable. CORS restricts browser origins but does not block non-browser callers; use private authentication if the API should be private.
- [ ] Consider an edge WAF or bot protection after configuring a custom domain and provider-side rules.

## Monitoring and cost controls

- [ ] Configure and verify alert delivery for elevated 5xx rates, LLM errors/timeouts, database failures, latency, quota use, and spend anomalies. Suggested Sentry rules are documented in `docs/deployment.md`, but require setup in the external monitoring dashboard.
- [ ] Verify OpenAI project spending limits and budget alerts in the provider dashboard.

## Capacity notes

- Application limits, provider/plan capacity factors, and a concurrency estimate are documented in `docs/deployment.md`.
- `npm run capacity:check` performs a bounded local fallback check; `npm run server:test` covers mocked server failures. Neither tests hosted LLM throughput.
