import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { rateLimit } from 'express-rate-limit';
import { generateDiagram, refineDiagram, fixMermaid } from './diagram';
import { describeDiagram, getLlmProvider, isLlmConfigured, checkLlmProviderHealth } from './llm';
import type { DiagramRequest } from '../../shared/types';
import { openApiSpec } from './openapi';
import * as metrics from './metrics';
import { asyncHandler, errorHandler } from './middleware/errorHandler';
import { requireApiSecret } from './middleware/auth';
import { createLlmRateLimiter, verifyUpstashConnection } from './middleware/rateLimit';
import { requestLogger } from './middleware/requestLogger';
import { requestId } from './middleware/requestId';
import {
  validateDescribeRequest,
  validateDiagramRequest,
  validateFixRequest,
  validateRefineRequest,
  validateShareRequest,
} from './middleware/validate';
import { isDatabaseConfigured, saveDiagram, getDiagram, getDatabaseStatus } from './db';

export function createApp() {
  getLlmProvider();
  const app = express();
  app.set('trust proxy', 1);
  const requestRateLimit = rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false,
  });

  app.use(helmet());
  app.use(compression());
  app.use(requestId);

  const originEnv = process.env.ALLOWED_ORIGIN;
  let parsedOrigin = originEnv ? originEnv.trim().replace(/^['"]|['"]$/g, '').replace(/\/$/, '') : undefined;
  if (parsedOrigin && !parsedOrigin.startsWith('http://') && !parsedOrigin.startsWith('https://')) {
    parsedOrigin = `https://${parsedOrigin}`; // Auto-prepend https:// if missing
  }

  const allowedOrigins = [
    parsedOrigin,
    'http://localhost:5173',          // Vite local dev
    'http://localhost:4173',          // Vite preview
  ].filter(Boolean) as string[];

  app.use(cors({
    origin: function (origin, callback) {
      // Allow non-browser requests (curl, Railway health checks) and listed origins
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origin "${origin}" not allowed`));
      }
    },
    credentials: true,
  }));

  app.use(express.json({ limit: '1mb' }));
  app.use(requestLogger);

  const llmRateLimit = createLlmRateLimiter();
  const apiAuth = requireApiSecret();

  app.get('/health', asyncHandler(async (_req, res) => {
    const fallback = !isLlmConfigured();
    const mem = process.memoryUsage();
    const metricsSnapshot = await metrics.getMetricsSnapshot();
    res.json({
      ok: true,
      fallback,
      database: isDatabaseConfigured(),
      persistence: isDatabaseConfigured() ? 'database' : 'in-memory',
      llmProvider: getLlmProvider(),
      uptime: Math.floor(process.uptime()),
      memory: {
        rss: mem.rss,
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
      },
      metrics: metricsSnapshot,
    });
  }));

  app.get('/ready', requestRateLimit, asyncHandler(async (_req, res) => {
    const [database, llm, rateLimiter] = await Promise.all([
      getDatabaseStatus(),
      checkLlmProviderHealth(),
      verifyUpstashConnection(),
    ]);
    const ready =
      (!database.configured || database.ready) &&
      (!llm.configured || llm.ready) &&
      (!rateLimiter.configured || rateLimiter.ready);
    res.status(ready ? 200 : 503).json({
      ok: ready,
      database,
      llm,
      rateLimiter,
    });
  }));

  app.get('/metrics', asyncHandler(async (_req, res) => {
    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    const snapshot = await metrics.getMetricsSnapshot();
    res.send(metrics.getPrometheusMetrics(snapshot));
  }));

  app.get('/metrics/providers', asyncHandler(async (_req, res) => {
    const durable = await metrics.getDurableProviderMetrics();
    res.json({
      store: durable ? 'upstash' : 'in-memory',
      durableAvailable: durable !== null,
      providers: durable ?? metrics.getProviderMetrics(),
    });
  }));

  app.get('/api/openapi.json', (_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.json(openApiSpec);
  });

  app.get('/api/docs', (_req, res) => {
    res
      .type('html')
      .setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'")
      .send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>LLM Chart Generator — API Docs</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.onload = () => {
      window.ui = SwaggerUIBundle({ url: '/api/openapi.json', dom_id: '#swagger-ui' });
    };
  </script>
</body>
</html>`);
  });

  app.post(
    '/api/diagram',
    requestRateLimit,
    apiAuth,
    llmRateLimit,
    validateDiagramRequest,
    asyncHandler(async (req, res) => {
      const mermaid = await generateDiagram(req.body as DiagramRequest);
      res.json({ mermaid });
    }),
  );

  app.post(
    '/api/refine',
    requestRateLimit,
    apiAuth,
    llmRateLimit,
    validateRefineRequest,
    asyncHandler(async (req, res) => {
      const { currentDiagram, instruction, diagramType } = req.body;
      const mermaid = await refineDiagram({ currentDiagram, instruction, diagramType });
      res.json({ mermaid });
    }),
  );

  app.post(
    '/api/fix',
    requestRateLimit,
    apiAuth,
    llmRateLimit,
    validateFixRequest,
    asyncHandler(async (req, res) => {
      const { mermaid, error } = req.body;
      const fixed = await fixMermaid({ mermaid, error });
      res.json({ mermaid: fixed });
    }),
  );

  app.post(
    '/api/describe',
    requestRateLimit,
    apiAuth,
    llmRateLimit,
    validateDescribeRequest,
    asyncHandler(async (req, res) => {
      const { mermaid } = req.body;
      const description = await describeDiagram(mermaid);
      res.json({ description });
    }),
  );

  app.post(
    '/api/diagrams/share',
    requestRateLimit,
    apiAuth,
    llmRateLimit,
    validateShareRequest,
    asyncHandler(async (req, res) => {
      const { mermaid, diagramType, title, direction, theme, sourceText } = req.body;
      const record = await saveDiagram({
        title,
        mermaid,
        diagramType: diagramType || 'flowchart',
        direction,
        theme,
        sourceText,
      });
      res.json(record);
    }),
  );

  app.get(
    '/api/diagrams/:id',
    asyncHandler(async (req, res) => {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const diagram = await getDiagram(id);
      if (!diagram) {
        res.status(404).json({ error: 'Diagram not found' });
        return;
      }
      res.json(diagram);
    }),
  );

  app.use(errorHandler);

  return app;
}
