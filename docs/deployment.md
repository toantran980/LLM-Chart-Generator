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
| `DAILY_RATE_LIMIT_MAX` | Optional | Daily requests per IP; default `200`. Verified Bearer callers bypass public quotas. |
| `DAILY_RATE_LIMIT_WINDOW_MS` | Optional | In-memory daily quota window in milliseconds; default `86400000` |
| `CLEANUP_ENABLED` | Optional | Set `false` to disable periodic cleanup; default enabled |
| `CLEANUP_INTERVAL_HOURS` | Optional | Cleanup interval; default `24` |
| `CLEANUP_RETENTION_DAYS` | Optional | Delete shares not accessed within this many days; default `90` |
| `SENTRY_DSN` | Optional | Enables Sentry error reporting |

## Database and migrations

Set `POSTGRES_URL` to enable durable share links. Run migrations during release/pre-deploy, for example with `npm run db:migrate`. Without a database URL, share links are process-local and do not survive backend restarts. With the database configured, failed writes return `503 DATABASE_ERROR` rather than a false success.

## Redis on Render

This backend currently uses Upstash's REST API, configured by `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. Render Key Value provides a standard Redis protocol URL in `REDIS_URL`; the current backend does not consume it. If only `REDIS_URL` is set, rate limiting falls back to process-local memory. Use Upstash REST credentials for shared rate limiting until native Redis URL support is implemented.

When Upstash is configured, `/ready` checks its connectivity. When it is not configured, readiness reports the in-memory rate-limit store as ready; it does not imply cross-instance limits.

## Monitoring

`SENTRY_DSN` is optional. Without it, the service still runs but does not send exceptions to Sentry. Add the DSN to the Render backend environment and configure Sentry alert rules separately. The API also exposes process-local Prometheus metrics at `/metrics`.

## Production checklist

1. Create a Neon database and configure `POSTGRES_URL`.
2. Run `npm run db:migrate` as a release/pre-deploy step.
3. Configure `OPENAI_API_KEY`, `ALLOWED_ORIGIN`, and the desired auth settings in Render.
4. If using shared rate limits, configure both Upstash REST variables and verify `/ready` reports `rateLimiter.store` as `upstash`.
5. Set `SENTRY_DSN` only if you want Sentry reporting, then configure alert rules in Sentry.
6. Configure Vercel's `VITE_API_BASE` and optional matching `VITE_APP_API_KEY`.
7. Verify the deployment with `/health`, `/ready`, and an end-to-end generation/share flow.
