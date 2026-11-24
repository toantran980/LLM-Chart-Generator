# API

The backend serves an OpenAPI document at `/api/openapi.json` and Swagger UI at `/api/docs`.

## Routes

| Method and path | Purpose |
| --- | --- |
| `GET /health` | Liveness, provider mode, process uptime, and process-local metrics |
| `GET /ready` | Readiness of configured database, LLM provider, and Upstash connection |
| `GET /metrics` | Process-local Prometheus text metrics |
| `GET /metrics/providers` | Provider latency, error, token, request-budget, and configured cost-estimate aggregates; shared through Upstash when configured |
| `POST /api/diagram` | Generate Mermaid from text and a requested diagram type |
| `POST /api/refine` | Refine Mermaid with an instruction |
| `POST /api/fix` | Repair Mermaid after a rendering error |
| `POST /api/describe` | Describe Mermaid in plain language |
| `POST /api/diagrams/share` | Save a validated diagram and return its share ID |
| `GET /api/diagrams/:id` | Retrieve a shared diagram |

Generation, refinement, repair, description, and share requests use the API authentication middleware when configured and are rate limited. Shared diagram retrieval is public by ID. CORS limits browser origins; it is not API authentication and does not block direct non-browser requests.

## Authentication

- `APP_API_KEY` accepts `X-API-Key` as a public abuse deterrent. If used in the frontend, its matching `VITE_APP_API_KEY` is public and must not be treated as a secret.
- `SERVER_API_KEY` accepts `Authorization: Bearer <key>` for server-to-server access.
- `REQUIRE_PRIVATE_AUTH=true` requires a valid Bearer token on protected routes.
- Verified Bearer requests bypass the public IP rate limits.

## Limits and validation

Public requests are limited by caller IP: default 20 requests per minute and 200 requests per day. Both values can be configured. Share requests and generation-related routes share the same limiter. With Upstash, the daily quota uses a sliding 24-hour window; the in-memory fallback uses a process-local window. Request bodies have field-specific length and type validation, with a 1 MB JSON body limit.

When Upstash REST credentials are absent or unavailable, the backend uses process-local limits. Counters then are not shared across replicas or restarts. See [Deployment](deployment.md#redis-on-render).
