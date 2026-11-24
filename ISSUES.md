# Deployment Readiness Issues

This file tracks gaps found in the current deployment. Items marked public-app-critical
should be addressed before promoting this project beyond a personal/public demo.

## Critical

### [Deployment] CI does not deploy or publish runtime artifacts

- [X] GitHub Actions remains CI-only, while Vercel and Render own deployments.
- [X] CI builds and validates both Docker images.
- [ ] Optional CD may be added later after provider-specific secrets and smoke URLs are defined.

### [Security] Public sharing endpoint is not protected or limited

- [X] `POST /api/diagrams/share` now uses the API authentication middleware when configured.
- [X] `POST /api/diagrams/share` now uses the shared LLM request limiter.
- [X] Mermaid, diagram type, title, source text, theme, and direction are validated.
- [X] Add storage limits and retention/cleanup behavior (`cleanupOldDiagrams`, payload character limits, retention based on `last_accessed_at`).
- [X] Add stronger abuse controls, quotas, or authentication beyond a public client key (`SERVER_API_KEY` Bearer auth, `DAILY_RATE_LIMIT_MAX` daily IP quotas, and `REQUIRE_PRIVATE_AUTH`).

### [Reliability] Share success does not guarantee database persistence

- [X] Database-configured share writes return `503 DATABASE_ERROR` when Neon persistence fails.
- [X] Failed database writes are not added to the in-memory success cache.
- [X] Unconfigured local/development mode retains in-memory fallback behavior.
- [X] Add retry behavior or a durable write queue for transient database failures (`withRetry` on writes).
- [X] Expose database persistence status separately from database configuration (`persistence` in `/health` and `/ready`).

### [Security] Browser API key is not a secret

- [X] Reframe `VITE_APP_API_KEY` as an abuse deterrent, not authentication, in docs and `.env.example`.
- [X] Keep `OPENAI_API_KEY` and database credentials server-only.
- [X] Anyone can extract `VITE_APP_API_KEY` from public client bundle to call protected server endpoints (mitigated with daily IP quotas, server-side Bearer auth, and optional `REQUIRE_PRIVATE_AUTH`).
- [X] Implement real server-side identity or authorization if private API access is required (`SERVER_API_KEY` with Bearer token authorization and `REQUIRE_PRIVATE_AUTH` mode).

### [Cost] Public LLM usage needs stronger OpenAI cost controls (deprecated or later)

- [X] Set a hard monthly OpenAI spending limit and budget alerts.
- [X] Use separate API keys and quotas for development and public production.
- [X] Add a daily request quota per caller IP.
- [X] Enforce rate and daily quotas per verified Bearer identity and caller IP (`AUTH_*` limits).
- [X] Add a global daily usage ceiling across all callers (`GLOBAL_DAILY_RATE_LIMIT_MAX`, default `1000`).
- [X] Record provider latency, provider-reported or estimated prompt tokens, requested completion tokens, and optional estimated OpenAI cost (`/metrics/providers`).
- [X] Document fallback behavior for provider errors and budget exhaustion (`docs/deployment.md`).

## High

### [Configuration] Canonicalize environment variable names

- [X] `VITE_API_BASE` is the canonical API URL used by the client; `VITE_APP_API_KEY` remains an optional public abuse-deterrent key.
- [X] Server supports both `POSTGRES_URL` and `DATABASE_URL`.
- [X] Docker Compose forwards both database variable names.
- [X] Keep one canonical documented name for each setting (`POSTGRES_URL` canonical, `DATABASE_URL` alias).
- [X] Add startup validation for conflicting or missing required configuration (`validateStartupConfig`).
- [X] Add a versioned `.env.example` containing variable names only, never real values.
- [X] Document build-time versus runtime client variables.

### [CI] Client tests are missing from CI

- [X] Server tests run in CI.
- [X] Client lint and build run in CI.
- [X] Client Vitest tests run in the CI workflow.
- [X] Complete test suite (server & client), linting, and workspace builds run in one unified required CI job (`test`).

### [Docker] Production containers are not reproducible or fully checked

- [X] Both Dockerfiles install workspace dependencies with `npm ci` and the root lockfile.
- [X] CI builds both server and client Docker images and runs integration smoke tests on pushes and pull requests.
- [X] Server image and Compose probe `/ready`; client image and Compose probe the served page.
- [X] Compose intentionally does not block the client on server health so the UI remains available during API/database outages.
- [X] Build and smoke-test both containers together (`docker compose up --build` with `scripts/smoke-test.mjs` in CI).

### [Reliability] Health endpoint is not a readiness endpoint

- [X] Added a separate `/ready` endpoint.
- [X] `/health` remains the process liveness/metrics endpoint.
- [X] `/ready` confirms whether a configured Neon database is reachable.
- [X] Expose storage mode (`persistence: 'database' | 'in-memory'`) on `/health` and `/ready`.
- [X] Add bounded provider probes for OpenAI or Ollama without increasing normal request cost (cached zero-token `/v1/models` and `/api/version` checks).

### [Reliability] Rate limiting degrades across replicas

- [X] Upstash failures fall back to in-memory limiting instead of returning `500`.
- [X] Rate-limit identity now uses caller IP, not the client-supplied `X-API-Key` header.
- [X] In-memory limiter is process-local; Upstash is used for shared counters when configured.
- [ ] Configure Upstash Redis in production and verify it across replicas (`verifyUpstashConnection()` only checks connectivity; it does not configure or prove production use).
- [ ] Support Render Key Value's standard `REDIS_URL`; the current limiter only supports Upstash REST URL/token credentials.
- [X] Consider verified user identity if account-based quotas are introduced (supported via `auth:<identity>` and `user:<id>`).

### [Reliability] In-memory metrics and fallback state are not durable

- [X] Request metrics are process-local and disappear on restart.
- [X] Expose durable provider aggregates through `/metrics/providers` when Upstash is configured.
- [ ] Expose durable HTTP request and fallback counters currently stored in Upstash; `/health` and `/metrics` still report process-local HTTP counters.
- [X] Export process-local metrics in Prometheus exposition format (`/metrics`).
- [ ] Configure and verify alerts for elevated 5xx rates, LLM errors, timeouts, and database failures (README lists suggested Sentry rules; no alert configuration is present in this repository).

### [Data] Sharing lacks lifecycle management

- [X] Shared diagrams expire after the configured inactive period using `last_accessed_at` (`cleanupOldDiagrams`).
- [X] Size quotas and string limits enforced on all share fields.
- [X] Record created and accessed timestamps (`last_accessed_at`) for lifecycle decisions.
- [X] Add periodic background cleanup jobs if scheduled automation is desired (`startPeriodicCleanup()` with `CLEANUP_ENABLED`, `CLEANUP_INTERVAL_HOURS`, `CLEANUP_RETENTION_DAYS`; `npm run db:cleanup` for manual runs).

## Medium

### [Infrastructure] No explicit deployment verification or rollback

- [X] Add post-deploy smoke tests calling `/health`, `/ready`, generation, refinement, sharing, or retrieval (`scripts/smoke-test.mjs`).
- [X] Gate pull requests on Docker integration smoke tests confirming client and server compatibility.
- [X] Check client/server package versions in CI and match release tags to package version (`release:check`).
- [X] Document manual rollback steps for Vercel and Render (`docs/deployment.md`).

### [Observability] Provider cost and latency are not fully measurable

- [X] Record provider latency, errors, token usage, and optional cost estimates in Upstash when configured.
- [X] Expose provider and per-endpoint telemetry through `/metrics` and `/metrics/providers`.
- [ ] Configure alerts for latency, timeout, quota, and spend anomalies.

### [Security] Share and API routes need broader abuse controls

- [X] Share routes have rate limiting.
- [X] Reframe API key in client as abuse deterrent in documentation.
- [ ] CORS allowlisting is not API access control; direct callers remain possible.
- [ ] Add an edge WAF or bot protection (requires a custom domain and provider-side configuration).
- [X] Add request quotas by verified identity and IP where possible (`AUTH_*` limits).

### [Performance] Client bundle size needs optimization

- [ ] Main JavaScript bundle is approximately 1.38 MB before gzip (Mermaid and PDF contribute to initial load).
- [ ] Lazy-load Mermaid diagram definitions and PDF viewer code.
- [ ] Measure and split the largest bundles.
- [ ] Add client performance budgets to CI.

### [Documentation] README deployment instructions are incomplete or inconsistent

- [X] Add exact Vercel and Render environment variable names.
- [X] Add a production startup checklist.
- [X] Remove or reconcile mismatched variable names.
- [X] Document the public nature of `VITE_*` variables.
- [X] Document database fallback and share-link durability behavior.

### [Reliability] No migrations or schema lifecycle

- [X] Add versioned migrations before schema changes grow (`server/src/migrate.ts`).
- [X] Run migrations during release, not lazily during requests (`npm run db:migrate`).

### [Reliability] No capacity or failure thresholds

- [ ] LLM timeout and request-size limits exist, but capacity behavior is not load-tested.
- [ ] Document database, Redis, provider, and Render limits.
- [ ] Conduct load and failure testing.
- [ ] Document expected concurrent requests and OpenAI/OpenRouter/Ollama limits.

## Verification Checklist

- [X] CI runs server tests, client tests, client lint, and production builds.
- [X] CI builds and smoke-tests both Docker containers together.
- [ ] Deployment has automated push/deploy, smoke tests, and rollback.
- [X] Environment variable names are consistent across code, Compose, CI, and docs.
- [X] Public share routes have validation, limits, persistence guarantees, and quotas.
- [X] Database failures do not return a falsely successful share link.
- [X] Real authorization exists if private API access is required.
- [ ] OpenAI hard budgets and alerts are configured.
- [X] `/health` and `/ready` have separate, correct meanings.
- [ ] Shared rate limiting is configured and verified across more than one running instance (Upstash support and a readiness probe exist; multi-instance verification is still outstanding).
- [X] Provider latency, token usage, requested completion budget, and optional OpenAI cost estimates are recorded; alerts still require external configuration.
