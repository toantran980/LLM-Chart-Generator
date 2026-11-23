# Architecture

LLM Chart Maker is an npm workspace with a browser frontend, an Express API, and shared TypeScript types.

## Components

| Component | Role |
| --- | --- |
| `frontend/` | React and Vite single-page app, Mermaid rendering, PDF text extraction, local history |
| `backend/` | Express API for diagram generation, refinement, repair, descriptions, sharing, health, and metrics |
| `shared/` | Types shared by the frontend and backend |
| Neon Postgres | Persistent shared diagrams when `POSTGRES_URL` or `DATABASE_URL` is configured |
| Upstash Redis | Shared rate-limit counters and optional durable counters when REST credentials are configured |

## Request flow

```text
Browser → React app → Express API → configured LLM provider
                         ├─ Neon Postgres for shared diagrams
                         └─ Upstash REST for shared rate limits (optional)
```

In local development, Vite serves the frontend on port `5173` and proxies API requests to the backend on `4173`. Docker Compose serves the frontend through Nginx on port `80` and the backend on `4000`. In the hosted deployment, Vercel serves the frontend and `VITE_API_BASE` points it to the Render backend.

## Persistence and fallback behavior

- Browser history is stored in `localStorage` and is separate from server-side share storage.
- With a database URL, shared diagram writes must persist to Neon or return an error. The backend does not claim a successful durable share when a database write fails.
- Without a database URL, shares use process-local memory and are lost when the backend restarts.
- Without valid Upstash REST credentials, rate limits and metrics are process-local. Render Key Value's standard `REDIS_URL` is not currently supported; see [Deployment](deployment.md).
- If an LLM provider is not configured or generation fails, generation can use the local parser. Refinement, repair, and LLM descriptions need a working LLM provider.

## Repository layout

```text
backend/       Express API, middleware, database access, and backend tests
docs/          Development, deployment, API, and architecture guides
frontend/      React application, Vite configuration, and frontend tests
scripts/       Smoke-test utilities
shared/        Shared TypeScript types
docker-compose.yml
package.json   Root npm workspace scripts
```
