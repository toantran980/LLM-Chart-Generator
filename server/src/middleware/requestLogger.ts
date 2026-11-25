import type { RequestHandler } from 'express';
import { log } from '../logger';
import { recordRequest } from '../metrics';

export const requestLogger: RequestHandler = (req, res, next) => {
  const start = Date.now();

  res.on('finish', () => {
    const durationMs = Date.now() - start;
    const routePath = req.route?.path;
    const metricPath = routePath ? `${req.baseUrl}${String(routePath)}` : 'unmatched';
    recordRequest(metricPath, res.statusCode, durationMs);
    log('info', 'request completed', {
      requestId: (req as any).id,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs,
      ip: req.ip,
    });
  });

  next();
};
