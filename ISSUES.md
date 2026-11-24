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
- [X] Add stronger abuse controls, quotas, or authentication beyond a public frontend key (`SERVER_API_KEY` Bearer auth, `DAILY_RATE_LIMIT_MAX` daily IP quotas, and `REQUIRE_PRIVATE_AUTH`).

### [Reliability] Share success does not guarantee database persistence

- [X] Database-configured share writes return `503 DATABASE_ERROR` when Neon persistence fails.
- [X] Failed database writes are not added to the in-memory success cache.
- [X] Unconfigured local/development mode retains in-memory fallback behavior.
- [X] Add retry behavior or a durable write queue for transient database failures (`withRetry` on writes).
- [X] Expose database persistence status separately from database configuration (`persistence` in `/health` and `/ready`).

### [Security] Browser API key is not a secret

- [X] Reframe `VITE_APP_API_KEY` as an abuse deterrent, not authentication, in docs and `.env.example`.
- [X] Keep `OPENAI_API_KEY` and database credentials backend-only.
- [X] Anyone can extract `VITE_APP_API_KEY` from public frontend bundle to call protected backend endpoints (mitigated with daily IP quotas, server-side Bearer auth, and optional `REQUIRE_PRIVATE_AUTH`).
- [X] Implement real server-side identity or authorization if private API access is required (`SERVER_API_KEY` with Bearer token authorization and `REQUIRE_PRIVATE_AUTH` mode).

### [Cost] Public LLM usage needs stronger OpenAI cost controls (deprecated or later)

- [ ] Set a hard monthly OpenAI spending limit and budget alerts.
- [ ] Use separate API keys and quotas for development and public production.
- [X] Add a daily request quota per caller IP.
- [ ] Add verified per-identity and global daily usage limits; authenticated Bearer callers currently bypass public quotas.
- [ ] Record provider latency and estimated/requested token cost.
- [ ] Define a fallback policy for provider errors and budget exhaustion.

## High

### [Configuration] Canonicalize environment variable names

- [X] `VITE_API_BASE` is the canonical frontend backend URL; `VITE_APP_API_KEY` remains an optional public abuse-deterrent key.
- [X] Backend supports both `POSTGRES_URL` and `DATABASE_URL`.
- [X] Docker Compose forwards both database variable names.
- [X] Keep one canonical documented name for each setting (`POSTGRES_URL` canonical, `DATABASE_URL` alias).
- [X] Add startup validation for conflicting or missing required configuration (`validateStartupConfig`).
- [X] Add a versioned `.env.example` containing variable names only, never real values.
- [X] Document build-time versus runtime frontend variables.

### [CI] Frontend tests are missing from CI

- [X] Backend tests run in CI.
- [X] Frontend lint and build run in CI.
- [X] Frontend Vitest tests run in the CI workflow.
- [X] Complete test suite (backend & frontend), linting, and workspace builds run in one unified required CI job (`test`).

### [Docker] Production containers are not reproducible or fully checked

- [X] Both Dockerfiles install workspace dependencies with `npm ci` and the root lockfile.
- [X] CI builds both backend and frontend Docker images on pushes to main.
- [X] Backend image and Compose probe `/ready`; frontend image and Compose probe the served page.
- [X] Compose intentionally does not block the frontend on backend health so the UI remains available during API/database outages.
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
- [ ] Durable Upstash counters are written, but `/health` and `/metrics` currently expose process-local counters; wire durable metrics into an endpoint or monitoring exporter.
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
- [ ] Add deployment status gate confirming frontend and backend are compatible.
- [ ] Add versioned frontend/backend release checks.
- [ ] Add rollback instructions or an automated rollback trigger.

### [Observability] Provider cost and latency are not fully measurable

- [ ] Existing metrics record endpoint latency and request counts, but provider latency, token usage, cost, and error classes are not durable.
- [ ] Add provider and per-endpoint telemetry.
- [ ] Configure alerts for latency, timeout, quota, and spend anomalies.

### [Security] Share and API routes need broader abuse controls

- [X] Share routes have rate limiting.
- [X] Reframe API key in frontend as abuse deterrent in documentation.
- [ ] CORS is allowlisted, but browser-only controls do not stop direct API requests.
- [ ] Consider an edge WAF or bot protection.
- [ ] Add request quotas by verified identity and IP where possible.

### [Performance] Frontend bundle size needs optimization

- [ ] Main JavaScript bundle is approximately 1.38 MB before gzip (Mermaid and PDF contribute to initial load).
- [ ] Lazy-load Mermaid diagram definitions and PDF viewer code.
- [ ] Measure and split the largest bundles.
- [ ] Add frontend performance budgets to CI.

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

- [X] CI runs backend tests, frontend tests, frontend lint, and production builds.
- [X] CI builds and smoke-tests both Docker containers together.
- [ ] Deployment has automated push/deploy, smoke tests, and rollback.
- [X] Environment variable names are consistent across code, Compose, CI, and docs.
- [X] Public share routes have validation, limits, persistence guarantees, and quotas.
- [X] Database failures do not return a falsely successful share link.
- [X] Real authorization exists if private API access is required.
- [ ] OpenAI hard budgets and alerts are configured.
- [X] `/health` and `/ready` have separate, correct meanings.
- [ ] Shared rate limiting is configured and verified across more than one running instance (Upstash support and a readiness probe exist; multi-instance verification is still outstanding).
- [ ] Provider latency and cost are monitored (not currently recorded); process-local HTTP metrics, database readiness, uptime, and Sentry error reporting have partial coverage.
