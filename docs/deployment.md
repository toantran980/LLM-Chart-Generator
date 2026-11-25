# Deployment

The current hosted setup uses Vercel for the frontend and Render for the backend. The frontend calls the backend URL configured at build time through `VITE_API_BASE`.

## Frontend on Vercel

| Variable | Required | Purpose |
| --- | --- | --- |
| `VITE_API_BASE` | Yes | Full URL of the Render backend, such as `https://<service>.onrender.com` |
| `VITE_APP_API_KEY` | Optional | Public abuse-deterrent value sent as `X-API-Key`; match `APP_API_KEY` on the backend if enabled |

All `VITE_*` values are embedded in the public browser bundle. Never put database credentials, provider keys, or private server secrets in them. `VITE_APP_API_KEY` is visible to users and is not authentication.

## Backend on Render

| Variable | Required | Purpose/default |
| --- | --- | --- |
| `PORT` | Optional | HTTP port; defaults to `4173` locally and is set by the container/platform in deployment |
| `POSTGRES_URL` | Recommended | Neon Postgres URL for durable sharing; `DATABASE_URL` is a supported alias |
| `OPENAI_API_KEY` | If using OpenAI | Private provider key; backend only |
| `OPENAI_API_URL` | Optional | Custom OpenAI-compatible chat-completions endpoint |
| `OPENAI_INPUT_USD_PER_1M_TOKENS` | Optional | Input-token price for the configured OpenAI model; enables estimated request costs |
| `OPENAI_OUTPUT_USD_PER_1M_TOKENS` | Optional | Output-token price for the configured OpenAI model; enables estimated request costs |
| `LLM_PROVIDER` | Optional | `openai` (default), `ollama`, or `fallback` |
| `LLM_TIMEOUT_MS` | Optional | Provider request timeout; default `60000` |
| `OLLAMA_URL` | If using Ollama | Provider base URL reachable from the backend |
| `OLLAMA_MODEL` | If using Ollama | Model name; default `qwen3:8b` |
| `ALLOWED_ORIGIN` | Yes in production | Frontend origin allowed by CORS |
| `APP_API_KEY` | Optional | Public deterrent matching `VITE_APP_API_KEY` |
| `SERVER_API_KEY` | Optional | Private Bearer token for server-to-server access |
| `REQUIRE_PRIVATE_AUTH` | Optional | Set `true` to require the private Bearer token |
| `UPSTASH_REDIS_REST_URL` | Optional | Upstash REST URL for shared rate limits |
| `UPSTASH_REDIS_REST_TOKEN` | Optional | Upstash REST token, required with the URL |
| `RATE_LIMIT_MAX` | Optional | Requests per IP per window; default `20` |
| `RATE_LIMIT_WINDOW_MS` | Optional | Rate-limit window in milliseconds; default `60000` |
| `DAILY_RATE_LIMIT_MAX` | Optional | Daily requests per IP; default `200`. Verified Bearer callers use separate `AUTH_*` quotas. |
| `DAILY_RATE_LIMIT_WINDOW_MS` | Optional | In-memory daily quota window in milliseconds; default `86400000` |
| `GLOBAL_DAILY_RATE_LIMIT_MAX` | Optional | Daily requests across all callers; default `1000`. Shared across instances when Upstash is configured. |
| `AUTH_RATE_LIMIT_MAX` | Optional | Requests per window for verified Bearer callers, enforced per verified identity and caller IP; default `20` |
| `AUTH_RATE_LIMIT_WINDOW_MS` | Optional | Verified Bearer caller window in milliseconds; defaults to `60000` |
| `AUTH_DAILY_RATE_LIMIT_MAX` | Optional | Daily requests for verified Bearer callers, enforced per verified identity and caller IP; default `200` |
| `CLEANUP_ENABLED` | Optional | Set `false` to disable periodic cleanup; default enabled |
| `CLEANUP_INTERVAL_HOURS` | Optional | Cleanup interval; default `24` |
| `CLEANUP_RETENTION_DAYS` | Optional | Delete shares not accessed within this many days; default `90` |
| `SENTRY_DSN` | Optional | Enables Sentry error reporting |

Bearer quotas are keyed by the verified server identity and caller IP. If a trusted server uses one `SERVER_API_KEY` for multiple authenticated users, it can forward a normalized `X-User-ID` so each verified user gets a separate identity quota. Never accept that header as identity from an unauthenticated or browser client.

## Database and migrations

Set `POSTGRES_URL` to enable durable share links. Run migrations during release/pre-deploy, for example with `npm run db:migrate`. Without a database URL, share links are process-local and do not survive backend restarts. With the database configured, failed writes return `503 DATABASE_ERROR` rather than a false success.

## Provider failure and budget policy

Diagram generation degrades to the local parser if the configured LLM is unavailable, returns an error, or rejects a request because of a provider quota or billing limit. The API logs the failure and records a fallback count; it does not retry the provider request. Refinement and Mermaid repair require the LLM and return an API error when the provider request fails. Descriptions use a local explanatory response only when no LLM is configured; provider errors are returned to the caller. Configure spending limits and alerts in the provider account because this application does not enforce a dollar budget.

## Redis on Render

This backend currently uses Upstash's REST API, configured by `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. Render Key Value provides a standard Redis protocol URL in `REDIS_URL`; the current backend does not consume it. If only `REDIS_URL` is set, rate limiting falls back to process-local memory. Use Upstash REST credentials for shared rate limiting until native Redis URL support is implemented.

When Upstash is configured, `/ready` checks its connectivity. When it is not configured, readiness reports the in-memory rate-limit store as ready; it does not imply cross-instance limits.

## Capacity and external service limits

The application has request and time limits, but it does not set a maximum number of simultaneous LLM requests or maintain a provider queue. Current defaults include 20 requests per IP per 60-second window, 200 per IP per day, 1,000 globally per day, a 15,000-character prompt limit, a 1 MB JSON body limit, a 60-second provider timeout, and requested completion limits of 1,000 tokens (500 for Mermaid repair). Bearer callers also have separate identity and IP quotas. These are application safeguards, not a capacity guarantee; changeable environment settings can alter several quotas.

Concurrency depends on request rate and provider response time. As a planning estimate, concurrent provider calls are approximately requests per second multiplied by average provider response time in seconds. For example, 2 requests/second with a 30-second average response time implies about 60 simultaneous calls. This is an estimate, not a measured production capacity. The app currently has no in-flight semaphore to cap that number.

Use `npm run capacity:check` for a bounded local check of the fallback parser, validation, and rate-limit behavior. It does not contact an LLM, database, Redis, or deployed service. `npm run server:test` exercises mocked failure cases, including provider timeouts and database errors. Neither command measures hosted provider throughput or proves capacity under production traffic. A hosted load test should use a controlled staging service and explicit provider spending limits.

External capacity is plan- and configuration-specific; check the service dashboards before setting a production concurrency target:

| Service | Capacity factors and checks |
| --- | --- |
| Neon Postgres | Connection limits depend on compute size. Use the pooled connection string for application traffic and check the current plan's `max_connections` and usage in Neon’s [connection pooling docs](https://neon.com/docs/connect/connection-pooling). |
| Upstash Redis | Request/command throughput, storage, and monthly command allowance depend on the selected plan. The Free plan currently lists 256 MB and 500,000 commands/month; each Redis operation consumes commands. Check current usage and plan limits in the [Upstash pricing page](https://upstash.com/pricing/redis). |
| Render | Instance resources and horizontal scaling depend on the service plan. Free web services are limited to one instance and do not scale horizontally; check the current [scaling documentation](https://render.com/docs/scaling) and service plan. |
| OpenAI | Request and token rate limits vary by model and project/account. Check the [rate-limit guide](https://developers.openai.com/api/docs/guides/rate-limits) and Limits page for the exact production project and model; this repo cannot infer those account limits. |
| OpenRouter | Paid model limits generally follow the upstream provider; free-model limits are separately capped and can change. The current free tier lists 20 requests/minute and 50 requests/day; accounts that have purchased at least $10 in credits get a 1,000/day free-model limit. Check [current pricing and limits](https://openrouter.ai/pricing). The app's model setting is currently hardcoded, so a custom OpenAI-compatible URL needs a compatible model endpoint before treating OpenRouter as supported. |
| Ollama | Parallelism depends on available memory, model size, and configuration. Ollama's `OLLAMA_NUM_PARALLEL` controls parallel requests; its queue is bounded (default 512) and can reject requests when overloaded. Check the [Ollama FAQ](https://github.com/ollama/ollama/blob/main/docs/faq.mdx) and host resources. |

No production concurrent-request target is established yet. Set one only after measuring the actual Render instance, database and Redis plans, provider project limits, and representative prompt latency together.

## Monitoring

`SENTRY_DSN` is optional. Without it, the service still runs but does not send exceptions to Sentry. Server errors sent to Sentry include `error_code`, `http_status`, `route`, and `method` tags when available. `/health` and `/metrics` use shared HTTP and fallback counters from Upstash when configured and reachable; otherwise they report process-local values. `/metrics/providers` returns provider aggregates from Upstash when configured, or process-local aggregates otherwise. Provider-reported token counts are used when available; otherwise prompt tokens are estimated from input length and completion tokens use the requested output limit. OpenAI cost estimates require both per-million-token price variables and use those configured rates. Ollama cost is not estimated.

### Suggested alert rules

Create and test these rules in the monitoring service; setting `SENTRY_DSN` only connects error reporting and does not create alerts. Sentry issue alerts can use event-count thresholds and filters. Use the `error_code` tag for targeted rules:

| Alert | Suggested condition |
| --- | --- |
| Elevated server errors | More than 5 error events with `http_status` at least 500 in 5 minutes |
| LLM failures | More than 3 events with `error_code:LLM_ERROR` in 5 minutes |
| LLM timeouts | At least 1 event with `error_code:LLM_TIMEOUT` in 5 minutes |
| Database failures | At least 1 event with `error_code:DATABASE_ERROR` in 5 minutes |

For request error-rate alerts, scrape `/metrics` and alert on `rate(http_requests_5xx_total[5m]) / rate(http_requests_total[5m])`; require nonzero request traffic to avoid division by zero. Sentry issue alerts do not configure OpenAI spending notifications; configure budget limits and spend alerts in the OpenAI account. These rules still require a notification target and verification in the external dashboard.

## Rollback

### Vercel frontend

In the Vercel Dashboard, open the project’s **Deployments** page, choose the last known-good production deployment, and use **Instant Rollback**. Verify the production domain and browser console afterward. An instant rollback reuses the previous build, so changing `VITE_API_BASE` in project settings does not update that build; redeploy if the API URL or other build-time variables changed. Vercel rollback behavior and plan limits are described in the [rollback docs](https://vercel.com/docs/deployments/rollback-production-deployment).

### Render API

In the Render Dashboard, open the web service’s **Deploys** page, select a recent successful deploy, and click **Rollback**. Verify `/health`, `/ready`, and a generation request. A dashboard rollback disables automatic deploys for that service; after fixing the issue, re-enable autodeploy from the service’s Settings page. Rollback availability depends on retained build artifacts. See [Render’s rollback docs](https://render.com/docs/rollbacks).

## Production checklist

1. Create a Neon database and configure `POSTGRES_URL`.
2. Run `npm run db:migrate` as a release/pre-deploy step.
3. Configure `OPENAI_API_KEY`, `ALLOWED_ORIGIN`, and the desired auth settings in Render.
4. If using shared rate limits, configure both Upstash REST variables and verify `/ready` reports `rateLimiter.store` as `upstash`.
5. Set `SENTRY_DSN` only if you want Sentry reporting, then create and verify the alert rules in [Suggested alert rules](#suggested-alert-rules).
6. Configure Vercel's `VITE_API_BASE` and optional matching `VITE_APP_API_KEY`.
7. Verify the deployment with `/health`, `/ready`, and an end-to-end generation/share flow.
