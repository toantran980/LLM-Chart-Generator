import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCleanupConfig, startPeriodicCleanup } from '../src/cleanup';
import * as dbModule from '../src/db';

describe('Periodic Cleanup Scheduler', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.CLEANUP_ENABLED;
    delete process.env.CLEANUP_INTERVAL_HOURS;
    delete process.env.CLEANUP_RETENTION_DAYS;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('reads default cleanup configuration', () => {
    const config = getCleanupConfig();
    expect(config.enabled).toBe(true);
    expect(config.intervalMs).toBe(24 * 60 * 60 * 1000);
    expect(config.retentionDays).toBe(90);
  });

  it('parses custom cleanup environment configuration', () => {
    process.env.CLEANUP_ENABLED = 'false';
    process.env.CLEANUP_INTERVAL_HOURS = '12';
    process.env.CLEANUP_RETENTION_DAYS = '30';

    const config = getCleanupConfig();
    expect(config.enabled).toBe(false);
    expect(config.intervalMs).toBe(12 * 60 * 60 * 1000);
    expect(config.retentionDays).toBe(30);
  });

  it('starts and stops periodic cleanup gracefully', () => {
    const cleanupSpy = vi.spyOn(dbModule, 'cleanupOldDiagrams').mockResolvedValue(0);

    const job = startPeriodicCleanup(100);
    expect(typeof job.stop).toBe('function');

    // Stop should safely cancel background timers
    job.stop();
  });

  it('does nothing when CLEANUP_ENABLED=false', () => {
    process.env.CLEANUP_ENABLED = 'false';
    const job = startPeriodicCleanup();
    expect(typeof job.stop).toBe('function');
    job.stop();
  });
});
