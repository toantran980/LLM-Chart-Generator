# Development

## Requirements

Use Node.js 24 and npm. The repository uses npm workspaces and a single root lockfile.

## Install and run

```bash
npm ci
npm run dev
```

Create a root `.env` file for local settings. For OpenAI-backed generation:

```env
OPENAI_API_KEY=your_openai_api_key
```

The frontend is at `http://localhost:5173`; the API is at `http://localhost:4173`. Without an API key, diagram generation and descriptions can use the local parser, while refinement and repair require an LLM provider.

## Use Ollama

Start Ollama locally and install a chat model, for example `qwen3:8b`. Add these settings to the root `.env`:

```env
LLM_PROVIDER=ollama
OLLAMA_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3:8b
```

`OLLAMA_URL` is the base URL, not the `/api/chat` endpoint. Increase `LLM_TIMEOUT_MS` if local inference needs longer than the default 60 seconds. The Ollama URL must be reachable from the backend. Docker Compose uses `host.docker.internal` by default; a hosted Render backend cannot reach Ollama on your computer through `localhost`. Ollama has no built-in authentication, so do not expose it directly to the internet.

`LLM_PROVIDER` accepts `openai`, `ollama`, and `fallback`. The `fallback` provider uses only the built-in parser.

## Common commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run frontend and backend together |
| `npm run build` | Build both workspaces |
| `npm test` | Run backend and frontend tests |
| `npm run frontend:lint` | Lint the frontend |
| `npm run backend:dev` | Run only the backend |
| `npm run frontend:dev` | Run only the frontend |
| `npm run db:migrate` | Apply database migrations |
| `npm run db:cleanup` | Run diagram retention cleanup manually |
| `npm run test:smoke` | Run the HTTP smoke-test script against configured URLs |

## Docker

```bash
docker compose up --build
```

Open `http://localhost`. Set `OPENAI_API_KEY` in the root `.env` to enable OpenAI features. Compose starts Nginx and the API; without database configuration, server-side shares are in memory.

## Troubleshooting

If the frontend or backend reports `EADDRINUSE`, another process is using that port. Stop the process that owns port `5173` or `4173`, then restart `npm run dev`.
