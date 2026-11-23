# LLM Chart Maker

Turn plain text or PDF content into editable Mermaid diagrams. Generate with an LLM or the built-in local parser, refine diagrams with natural language, edit Mermaid source directly, and share diagrams with a link.

[Try the live app](https://llm-chart-maker-frontend.vercel.app/)

## What it can do

- Generate flowcharts, timelines, rules maps, Gantt charts, ER diagrams, mind maps, Git graphs, and other Mermaid types supported by the renderer.
- Generate from text, a selection, or a PDF; refine, describe, and repair diagrams.
- Edit Mermaid code, zoom and pan, use presentation mode, and export SVG or PNG.
- Share diagrams and keep recent work in browser history.
- Use OpenAI, Ollama, or the local parser fallback.

## Start locally

```bash
npm ci
npm run dev
```

The frontend runs at `http://localhost:5173`; the backend runs at `http://localhost:4173`. For LLM generation, add `OPENAI_API_KEY` to the root `.env`. See [Development](docs/development.md) for provider setup, scripts, and Docker instructions.

## Project docs

- [Development](docs/development.md): local setup, Ollama, scripts, and Docker.
- [Deployment](docs/deployment.md): Vercel, Render, environment variables, database, Redis, and monitoring.
- [Architecture](docs/architecture.md): application structure and request/data flow.
- [API](docs/api.md): routes, authentication, limits, and interactive API docs.
- [Roadmap](ROADMAP.md): consolidated product and UX backlog.
- [Deployment readiness issues](ISSUES.md): operational gaps and verification status.

## Stack

React, TypeScript, Vite, Mermaid, PDF.js, Express, Neon Postgres, Docker, and GitHub Actions. The frontend is deployed on Vercel and the backend on Render.

Keyboard shortcuts: `Ctrl/Cmd+Enter` generates from the editor; `Ctrl/Cmd+Shift+Enter` generates from the selection when one is available.

## License

MIT. See [LICENSE](LICENSE).
