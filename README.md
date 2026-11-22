# LLM Chart Maker

LLM Chart Maker is a full-stack TypeScript app that turns plain text and PDF content into editable Mermaid diagrams. It uses OpenAI when configured and falls back to a local parser when the LLM is unavailable.

Live App: https://llm-chart-maker-frontend.vercel.app/

[![React](https://img.shields.io/badge/React-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white)](https://vitejs.dev/)
[![Mermaid](https://img.shields.io/badge/Mermaid-FF3670?style=for-the-badge&logo=mermaid&logoColor=white)](https://mermaid.js.org/)
[![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-000000?style=for-the-badge&logo=express&logoColor=white)](https://expressjs.com/)
[![Neon](https://img.shields.io/badge/Neon_Postgres-00E599?style=for-the-badge&logo=neon&logoColor=black)](https://neon.tech/)
[![Nginx](https://img.shields.io/badge/Nginx-009639?style=for-the-badge&logo=nginx&logoColor=white)](https://nginx.org/)
[![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)
[![GitHub Actions](https://img.shields.io/badge/GitHub_Actions-2088FF?style=for-the-badge&logo=githubactions&logoColor=white)](https://github.com/features/actions)

---

## Tech stack

- **Frontend:** React 19, TypeScript, Vite, Mermaid.js, PDF.js, Vitest, ESLint
- **Backend:** Node.js, Express, TypeScript, Vitest, Axios, `@neondatabase/serverless`
- **Database:** Neon Postgres (Lakebase Postgres) for persistent diagrams and shareable links (with local storage & in-memory fallback)
- **Infrastructure:** npm workspaces, Docker Compose, Nginx, GitHub Actions CI, Vercel (frontend), Render (backend)
- **AI:** OpenAI-compatible LLM integration with a local parser fallback
- **Production:** Helmet, compression, request IDs, structured logging, rate limiting (Upstash Redis or in-memory)

---

## Current capabilities

- Generate flowcharts, timelines, rules maps, Gantt charts, ER diagrams, mind maps, and Git graphs
- Generate from all editor text, a text selection, highlighted text, a PDF selection, or an entire PDF
- Choose an automatic, left-to-right, right-to-left, top-to-bottom, or bottom-to-top layout where supported
- Choose **Auto (AI chooses)** to let the LLM select any Mermaid diagram type supported by the renderer; local fallback mode remains limited to the built-in diagram types
- Refine a diagram with natural-language instructions and request a plain-language description
- Edit Mermaid source in the app, then copy the code or an embeddable SVG snippet
- Share diagrams via unique URLs (`?share=<id>`) backed by Neon Postgres
- Export rendered diagrams as SVG or PNG; zoom and pan the canvas; select one of five Mermaid themes
- Recover from Mermaid render errors with an automatic fix attempt and a manual retry
- Restore the most recent 20 diagrams from browser-local history

### Keyboard shortcuts

- `Ctrl/Cmd+Enter` — generate a diagram from all editor text
- `Ctrl/Cmd+Shift+Enter` — generate from the current selection, highlights, or editor text fallback

Diagrams can be shared via direct link (`?share=<id>`) backed by Neon Postgres. Browser history is stored locally in `localStorage`, maintaining seamless offline fallback if the database is unconfigured.

---

## Architecture

```
repository root (npm workspace)
├── package.json       # Root scripts: dev, build, test, and workspace tasks
├── package-lock.json  # Single dependency lockfile for both workspaces
├── .gitignore         # Consolidated ignore patterns for entire workspace
├── .dockerignore      # Consolidated Docker ignore patterns (build context: root)
├── docker-compose.yml # Docker orchestration for full stack
├── shared/            # Shared TypeScript interfaces and diagram request types
├── frontend/          # React + Vite SPA with Mermaid.js and PDF rendering
│   ├── Dockerfile     # Frontend Docker build configuration
│   └── nginx.conf     # Nginx configuration for serving static files
└── backend/           # Express API with LLM-powered generation and fix endpoints
    └── Dockerfile     # Backend Docker build configuration
```

```text
Local development
  Browser → React + Vite frontend (:5173)
              └─ Vite proxies /api requests → Express backend (:4173)
                                                 └─ OpenAI API

Docker Compose
  Browser → Nginx frontend (:80)
              └─ proxies /api requests → Express backend (:4000)
                                             └─ OpenAI API

Separate frontend/backend deployment
  Browser → static frontend
              └─ calls VITE_API_BASE → Express backend → OpenAI API

frontend and backend both import shared types from shared/types.ts.
```

Dependencies are hoisted to root `node_modules/` via npm workspaces. `frontend/node_modules/` contains only packages with strict version requirements (e.g., `@vercel/*`).

---

## Quick start

```bash
npm install
```

Create a `.env` file in the repository root:

```env
OPENAI_API_KEY=your_openai_api_key_here
```

By default, `OPENAI_API_KEY` enables LLM generation, refinement, syntax repairs, and descriptions. Without it, initial diagram generation and descriptions use local fallbacks; refinement and syntax repair require an LLM provider.

### Local Ollama option

The backend can use Ollama from [my-local-agent](https://github.com/toantran980/my-local-agent) instead of OpenAI. Start Ollama and make sure `qwen3:8b` is installed (`ollama list`), then set these values in the root `.env`:

```env
LLM_PROVIDER=ollama
OLLAMA_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3:8b
```

Restart the backend after changing the configuration. An OpenAI key is not needed in Ollama mode. `OLLAMA_URL` is the base URL, not the `/api/chat` endpoint; the model must support chat. `LLM_TIMEOUT_MS` can be increased if local inference takes longer than the default 60 seconds.

`LLM_PROVIDER` accepts `openai` (default), `ollama`, or `fallback` (local parser only). If the selected LLM is unavailable, generation uses the parser fallback; refinement, repair, and LLM descriptions report an error. The health endpoint's `fallback` flag describes configuration, not whether Ollama is currently reachable.

The URL must be reachable **from the backend**. For a backend running in Docker, Compose defaults to `http://host.docker.internal:11434`; host networking and Ollama's bind address may require additional configuration. Render cannot reach Ollama on your computer via `localhost`: use a securely authenticated private connection or run the backend locally. Ollama has no built-in authentication; do not expose it directly to the internet. Text and diagrams are sent to the configured provider.

### Production deployment & environment variables

The application is deployed across **Vercel** (Frontend) and **Render** (Backend).

#### Frontend environment variables (Vercel)

> [!IMPORTANT]
> All `VITE_*` variables are baked into static client bundles at build time and can be inspected by anyone in the browser. Never configure database passwords, OpenAI private keys, or server secrets as `VITE_*` variables. `VITE_APP_API_KEY` functions as an abuse deterrent for public APIs, not authorization.

| Variable | Required | Purpose |
| -------- | -------- | ------- |
| `VITE_API_BASE` | Yes (in prod) | Full URL of the backend API (e.g. `https://llm-chart-maker-backend.onrender.com`) |
| `VITE_APP_API_KEY` | Optional | Shared deterrent key sent in `X-API-Key` headers (must match `APP_API_KEY` on Render) |

#### Backend environment variables (Render)

| Variable | Required | Default / Purpose |
| -------- | -------- | ----------------- |
| `POSTGRES_URL` | Recommended | Full Neon Postgres connection string (`DATABASE_URL` supported as alias). Enables durable diagram sharing. |
| `OPENAI_API_KEY` | If using OpenAI | Secret OpenAI API key (kept backend-only). |
| `LLM_PROVIDER` | Optional | `openai` (default), `ollama`, or `fallback` (local parser only). |
| `ALLOWED_ORIGIN` | Yes (in prod) | Vercel production frontend origin allowed for CORS (e.g. `https://llm-chart-maker-frontend.vercel.app`). |
| `APP_API_KEY` | Optional | Public frontend deterrent key matching `VITE_APP_API_KEY` (sent via `X-API-Key`). |
| `SERVER_API_KEY` | Optional | Real private server secret for backend/worker access (sent via `Authorization: Bearer <key>`). |
| `REQUIRE_PRIVATE_AUTH` | Optional | When set to `true`, strictly requires Bearer token authentication and blocks public keys. |
| `UPSTASH_REDIS_REST_URL` | Optional | Shared rate-limit store URL (falls back to in-memory if unset). |
| `UPSTASH_REDIS_REST_TOKEN`| Optional | Upstash REST token (required if `UPSTASH_REDIS_REST_URL` is set). |
| `RATE_LIMIT_MAX` | Optional | Max requests per IP per minute (default: 20). |
| `RATE_LIMIT_WINDOW_MS` | Optional | Rate-limit window in ms (default: 60000). |
| `DAILY_RATE_LIMIT_MAX` | Optional | Daily request quota per IP (default: 200). Verified Bearer callers bypass public quotas. |
| `CLEANUP_ENABLED` | Optional | Set to `false` to disable the periodic background cleanup job (default: enabled). |
| `CLEANUP_INTERVAL_HOURS` | Optional | How often the cleanup job runs in hours (default: 24). |
| `CLEANUP_RETENTION_DAYS` | Optional | Delete shared diagrams not accessed in this many days (default: 90). |
| `SENTRY_DSN` | Optional | Error tracking and alerting DSN. |

#### Database fallback & share durability

- **With Neon configured (`POSTGRES_URL`):** Share requests are persisted durably with automatic retries for transient connection issues. If the database is completely unreachable, writes fail cleanly with `503 DATABASE_ERROR` so clients know persistence was not achieved.
- **Without Neon (`POSTGRES_URL` unset):** The backend operates in local in-memory fallback mode for diagram sharing, allowing zero-config local development and testing.

#### Production startup checklist

1. **Database:** Create a Neon Postgres database project and copy the connection string.
2. **Schema:** Run `npm run db:migrate` locally or in Render's release/pre-deploy command to apply database migrations.
3. **Backend Service (Render):** Set `POSTGRES_URL`, `OPENAI_API_KEY`, `ALLOWED_ORIGIN`, and optional `APP_API_KEY` / `UPSTASH_*`.
4. **Backend Health Check:** Verify `https://<backend-url>/ready` returns `{"ok": true, "database": {"configured": true, "ready": true, "persistence": "database"}, "rateLimiter": {"store": "upstash", "ready": true}}`.
5. **Observability & Alerts (optional):** Set `SENTRY_DSN` on the backend to enable Sentry error reporting, then configure alert rules for `http_status >= 500`, `error_code == DATABASE_ERROR`, and `error_code in [LLM_TIMEOUT, LLM_ERROR]`. Without a DSN, Sentry reporting is disabled. Prometheus metrics are available at `/metrics`.
6. **Frontend Service (Vercel):** Set `VITE_API_BASE` pointing to the backend URL and matching `VITE_APP_API_KEY`.
7. **End-to-End Smoke Test:** Open the frontend URL, generate a diagram, refine it, and create a shareable link. Verify `/api/diagrams/:id` loads correctly.

Rate limiting currently supports Upstash's REST API credentials only. Render Key Value's `REDIS_URL` is a standard Redis protocol URL and is not consumed by this backend; setting it alone leaves rate limiting in process-local memory. To use shared rate limits on Render, configure Upstash REST credentials until native `REDIS_URL` support is added.

```bash
npm run dev
```

- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:4173`
- Health check: `http://localhost:4173/health`

---

## Scripts

| Command                   | Description                         |
| ------------------------- | ----------------------------------- |
| `npm run dev`           | Start frontend and backend together |
| `npm run build`         | Build frontend and backend          |
| `npm run test`          | Run frontend and backend tests      |
| `npm run test:smoke`    | Run container and post-deploy smoke tests |
| `npm run db:migrate`    | Run Neon database migrations        |
| `npm run db:cleanup`    | Manually run the diagram cleanup job (deletes old shared diagrams) |
| `npm run frontend:lint` | Lint the frontend                   |
| `npm run backend:dev`   | Start backend only                  |
| `npm run frontend:dev`  | Start frontend only                 |

Individual workspace scripts are available for running one service by itself (`npm run backend:dev`, `npm run frontend:build`, etc.).

### Troubleshooting

If `npm run dev` fails with `EADDRINUSE` on port 4173 or 5173, kill any lingering Node processes:

```bash
# Windows
taskkill /F /IM node.exe

# macOS / Linux
killall node
```

Then re-run `npm run dev`.

---

## Docker

```bash
docker compose up --build
```

Visit `http://localhost` in your browser. Provide `OPENAI_API_KEY` in the root `.env` file before starting if you want LLM-powered features.

---

## API endpoints

| Endpoint                     | Purpose                                                            |
| ---------------------------- | ------------------------------------------------------------------ |
| `GET /health`              | Reports availability, fallback mode, database status, uptime, etc. |
| `GET /ready`               | Readiness probe for database, LLM provider, and Upstash Redis.     |
| `GET /metrics`             | Prometheus metrics exposition format for monitoring & scraping.    |
| `POST /api/diagram`        | Generates a Mermaid diagram from source text.                      |
| `POST /api/refine`         | Refines an existing diagram from an instruction.                   |
| `POST /api/fix`            | Attempts to repair Mermaid code after a render error.              |
| `POST /api/describe`       | Returns a plain-language description of Mermaid code.              |
| `POST /api/diagrams/share` | Saves a diagram to Neon Postgres and returns a shareable link.     |
| `GET /api/diagrams/:id`    | Retrieves a saved shared diagram by ID.                            |

LLM routes validate request bodies and enforce size limits. Default rate limit: 20 requests per caller IP per minute, plus a daily quota of 200 requests per IP. Verified Bearer callers bypass these public quotas. Configure `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS`, and `DAILY_RATE_LIMIT_MAX` for a different policy. Set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` for shared rate limiting across instances.

---

## License

This project is open source under the MIT License. See the [LICENSE](LICENSE) file for details.
