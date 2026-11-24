import 'dotenv/config';
import { cleanupOldDiagrams } from './db';
import { log } from './logger';

export interface CleanupConfig {
  enabled: boolean;
  intervalMs: number;
  retentionDays: number;
}

export function getCleanupConfig(): CleanupConfig {
  const enabled = process.env.CLEANUP_ENABLED !== 'false';
  const hours = Number(process.env.CLEANUP_INTERVAL_HOURS) || 24;
  const intervalMs = hours * 60 * 60 * 1000;
  const retentionDays = Number(process.env.CLEANUP_RETENTION_DAYS) || 90;
  return { enabled, intervalMs, retentionDays };
}

export function startPeriodicCleanup(warmupDelayMs = 10_000): { stop: () => void } {
  const config = getCleanupConfig();
  if (!config.enabled) {
    log('info', 'Periodic cleanup job is disabled via CLEANUP_ENABLED=false');
    return { stop: () => {} };
  }

  log('info', 'Starting periodic background cleanup job', {
    intervalHours: config.intervalMs / (60 * 60 * 1000),
    retentionDays: config.retentionDays,
  });

  const initialTimer = setTimeout(async () => {
    try {
      await cleanupOldDiagrams(config.retentionDays);
    } catch (err) {
      log('error', 'Initial background cleanup failed', { error: String(err) });
    }
  }, warmupDelayMs);
  initialTimer.unref();

  const interval = setInterval(async () => {
    try {
      await cleanupOldDiagrams(config.retentionDays);
    } catch (err) {
      log('error', 'Periodic background cleanup failed', { error: String(err) });
    }
  }, config.intervalMs);
  interval.unref();

  return {
    stop: () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
      log('info', 'Periodic cleanup job stopped');
    },
  };
}

if (require.main === module) {
  const { retentionDays } = getCleanupConfig();
  log('info', 'Executing standalone database cleanup task...', { retentionDays });
  cleanupOldDiagrams(retentionDays)
    .then((deleted) => {
      log('info', 'Standalone database cleanup task completed', { deletedCount: deleted });
      process.exit(0);
    })
    .catch((err) => {
      log('error', 'Standalone database cleanup task failed', { error: String(err) });
      process.exit(1);
    });
}
