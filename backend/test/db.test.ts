import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanupOldDiagrams,
  getDiagram,
  resetInMemoryDiagrams,
  saveDiagram,
  withRetry,
} from '../src/db';

describe('Database & Persistence', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.POSTGRES_URL;
    delete process.env.DATABASE_URL;
    resetInMemoryDiagrams();
  });

  afterEach(() => {
    process.env = originalEnv;
    resetInMemoryDiagrams();
    vi.restoreAllMocks();
  });

  it('withRetry succeeds on initial attempt without retrying', async () => {
    let attempts = 0;
    const result = await withRetry(async () => {
      attempts++;
      return 'ok';
    }, 3, 10);

    expect(result).toBe('ok');
    expect(attempts).toBe(1);
  });

  it('withRetry retries on transient errors and succeeds on second attempt', async () => {
    let attempts = 0;
    const result = await withRetry(async () => {
      attempts++;
      if (attempts === 1) {
        throw new Error('Connection reset');
      }
      return 'recovered';
    }, 3, 10);

    expect(result).toBe('recovered');
    expect(attempts).toBe(2);
  });

  it('withRetry throws last error when all retries are exhausted', async () => {
    let attempts = 0;
    await expect(
      withRetry(async () => {
        attempts++;
        throw new Error('Fatal database outage');
      }, 2, 10),
    ).rejects.toThrow('Fatal database outage');

    expect(attempts).toBe(2);
  });

  it('tracks lastAccessedAt when saving and retrieving in-memory diagrams', async () => {
    const saved = await saveDiagram({
      mermaid: 'graph TD; A-->B;',
      diagramType: 'flowchart',
      title: 'Test Diagram',
    });

    expect(saved.id).toBeDefined();
    expect(saved.lastAccessedAt).toBeDefined();

    const fetched = await getDiagram(saved.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.id).toBe(saved.id);
    expect(fetched?.lastAccessedAt).toBeDefined();
  });

  it('cleanupOldDiagrams removes diagrams not accessed within the retention threshold', async () => {
    const fresh = await saveDiagram({
      id: 'fresh-1',
      mermaid: 'graph TD; A-->B;',
      diagramType: 'flowchart',
    });

    const old = await saveDiagram({
      id: 'old-1',
      mermaid: 'graph TD; C-->D;',
      diagramType: 'flowchart',
    });
    const oldButRecentlyAccessed = await saveDiagram({
      id: 'old-recently-accessed',
      mermaid: 'graph TD; E-->F;',
      diagramType: 'flowchart',
    });

    // An inactive diagram older than 90 days should expire.
    const inactiveDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
    old.createdAt = inactiveDate;
    old.lastAccessedAt = inactiveDate;

    // An old diagram with recent activity should be retained.
    oldButRecentlyAccessed.createdAt = inactiveDate;
    oldButRecentlyAccessed.lastAccessedAt = new Date().toISOString();

    const removed = await cleanupOldDiagrams(90);
    expect(removed).toBe(1);

    expect(await getDiagram('fresh-1')).not.toBeNull();
    expect(await getDiagram('old-1')).toBeNull();
    expect(await getDiagram('old-recently-accessed')).not.toBeNull();
  });
});
