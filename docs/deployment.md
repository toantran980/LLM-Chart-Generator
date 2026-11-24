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

## Monitoring

`SENTRY_DSN` is optional. Without it, the service still runs but does not send exceptions to Sentry. Add the DSN to the Render backend environment and configure Sentry alert rules separately. `/metrics` exposes process-local HTTP and provider metrics in Prometheus format. `/metrics/providers` returns provider aggregates from Upstash when configured, or process-local aggregates otherwise. Provider-reported token counts are used when available; otherwise prompt tokens are estimated from input length and completion tokens use the requested output limit. OpenAI cost estimates require both per-million-token price variables and use those configured rates. Ollama cost is not estimated.

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
5. Set `SENTRY_DSN` only if you want Sentry reporting, then configure alert rules in Sentry.
6. Configure Vercel's `VITE_API_BASE` and optional matching `VITE_APP_API_KEY`.
7. Verify the deployment with `/health`, `/ready`, and an end-to-end generation/share flow.
