import * as Sentry from '@sentry/node';
import { log } from './logger';

let sentryEnabled = false;

export function initObservability(): void {
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: 0.1,
  });
  sentryEnabled = true;
  log('info', 'Sentry initialized');
}

export function captureException(err: unknown, context?: Record<string, unknown>): void {
  const errorMessage = err instanceof Error ? err.message : String(err);
  log('error', 'exception captured', {
    error: errorMessage,
    ...context,
  });

  if (sentryEnabled) {
    Sentry.withScope((scope) => {
      if (context) {
        if (context.code) scope.setTag('error_code', String(context.code));
        if (context.statusCode || context.status) {
          scope.setTag('http_status', String(context.statusCode || context.status));
        }
        if (context.path) scope.setTag('route', String(context.path));
        if (context.method) scope.setTag('method', String(context.method));
        scope.setExtras(context);
      }
      if (err instanceof Error) {
        Sentry.captureException(err);
      } else {
        Sentry.captureMessage(errorMessage, 'error');
      }
    });
  }
}
