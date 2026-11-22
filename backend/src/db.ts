import { neon } from '@neondatabase/serverless';
import crypto from 'crypto';
import { log } from './logger';
import { ApiError } from './errors';

export interface SharedDiagram {
  id: string;
  title: string | null;
  mermaid: string;
  diagramType: string;
  direction: string | null;
  theme: string | null;
  sourceText: string | null;
  createdAt: string;
  lastAccessedAt?: string;
}

export interface DatabaseStatus {
  configured: boolean;
  ready: boolean;
  persistence: 'database' | 'in-memory';
}

// In-memory fallback cache in case DB is unconfigured or temporarily unreachable
const inMemoryDiagrams = new Map<string, SharedDiagram>();

export function resetInMemoryDiagrams(): void {
  inMemoryDiagrams.clear();
}

export function getDatabaseUrl(): string | null {
  const url = process.env.POSTGRES_URL?.trim() || process.env.DATABASE_URL?.trim();
  return url || null;
}

let sqlClient: ReturnType<typeof neon> | null = null;
let schemaInitialized = false;
let databaseReachable = false;

export function isDatabaseConfigured(): boolean {
  return Boolean(getDatabaseUrl());
}

export async function getDatabaseStatus(): Promise<DatabaseStatus> {
  const configured = isDatabaseConfigured();
  if (!configured) {
    return { configured: false, ready: true, persistence: 'in-memory' };
  }

  const sql = getSql();
  if (!sql) {
    databaseReachable = false;
    return { configured: true, ready: false, persistence: 'in-memory' };
  }

  try {
    await initDbSchema();
    await sql`SELECT 1`;
    databaseReachable = true;
  } catch {
    databaseReachable = false;
  }

  return {
    configured: true,
    ready: databaseReachable,
    persistence: databaseReachable ? 'database' : 'in-memory',
  };
}

function getSql(): ReturnType<typeof neon> | null {
  if (sqlClient) return sqlClient;
  const url = getDatabaseUrl();
  if (!url) return null;
  try {
    sqlClient = neon(url);
    return sqlClient;
  } catch (err) {
    log('error', 'Failed to initialize Neon SQL client', { error: String(err) });
    return null;
  }
}

export async function initDbSchema(): Promise<boolean> {
  if (schemaInitialized) return true;
  const sql = getSql();
  if (!sql) return false;

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS shared_diagrams (
        id VARCHAR(32) PRIMARY KEY,
        title VARCHAR(255),
        mermaid TEXT NOT NULL,
        diagram_type VARCHAR(64) NOT NULL,
        direction VARCHAR(32),
        theme VARCHAR(64),
        source_text TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        last_accessed_at TIMESTAMPTZ DEFAULT NOW()
      );
    `;
    await sql`
      ALTER TABLE shared_diagrams
      ADD COLUMN IF NOT EXISTS last_accessed_at TIMESTAMPTZ DEFAULT NOW();
    `;
    schemaInitialized = true;
    log('info', 'Neon database schema verified/initialized successfully');
    return true;
  } catch (err) {
    log('warn', 'Failed to initialize Neon database schema; falling back to in-memory store', {
      error: String(err),
    });
    return false;
  }
}

export async function withRetry<T>(fn: () => Promise<T>, maxRetries = 2, delayMs = 200): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        log('warn', `Database operation attempt ${attempt} failed, retrying in ${delayMs}ms...`, {
          error: String(err),
        });
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastError;
}

export async function saveDiagram(input: {
  id?: string;
  title?: string;
  mermaid: string;
  diagramType: string;
  direction?: string;
  theme?: string;
  sourceText?: string;
}): Promise<SharedDiagram> {
  const id = input.id || crypto.randomBytes(6).toString('base64url');
  const now = new Date().toISOString();

  const record: SharedDiagram = {
    id,
    title: input.title || null,
    mermaid: input.mermaid,
    diagramType: input.diagramType,
    direction: input.direction || null,
    theme: input.theme || null,
    sourceText: input.sourceText || null,
    createdAt: now,
    lastAccessedAt: now,
  };

  const sql = getSql();
  if (!sql) {
    inMemoryDiagrams.set(id, record);
    return record;
  }

  try {
    const schemaReady = await initDbSchema();
    if (!schemaReady) {
      throw new Error('Shared diagram database schema is unavailable');
    }
    await withRetry(async () => {
      await sql`
        INSERT INTO shared_diagrams (
          id, title, mermaid, diagram_type, direction, theme, source_text, created_at, updated_at, last_accessed_at
        ) VALUES (
          ${id},
          ${record.title},
          ${record.mermaid},
          ${record.diagramType},
          ${record.direction},
          ${record.theme},
          ${record.sourceText},
          ${record.createdAt},
          ${record.createdAt},
          ${record.createdAt}
        )
        ON CONFLICT (id) DO UPDATE SET
          title = EXCLUDED.title,
          mermaid = EXCLUDED.mermaid,
          diagram_type = EXCLUDED.diagram_type,
          direction = EXCLUDED.direction,
          theme = EXCLUDED.theme,
          source_text = EXCLUDED.source_text,
          updated_at = NOW(),
          last_accessed_at = NOW();
      `;
    });
    inMemoryDiagrams.set(id, record);
    return record;
  } catch (err) {
    log('error', 'Failed to persist shared diagram to Neon', {
      id,
      error: String(err),
    });
    throw new ApiError(
      'Unable to save the shared diagram. Please try again.',
      503,
      'DATABASE_ERROR',
    );
  }
}

export async function getDiagram(id: string): Promise<SharedDiagram | null> {
  const sql = getSql();
  if (sql) {
    try {
      await initDbSchema();
      const result = await sql`
        SELECT
          id,
          title,
          mermaid,
          diagram_type as "diagramType",
          direction,
          theme,
          source_text as "sourceText",
          created_at as "createdAt",
          last_accessed_at as "lastAccessedAt"
        FROM shared_diagrams
        WHERE id = ${id}
        LIMIT 1;
      `;
      const rows = result as unknown as Record<string, unknown>[];
      if (Array.isArray(rows) && rows.length > 0) {
        const row = rows[0] as unknown as SharedDiagram;
        row.lastAccessedAt = new Date().toISOString();
        inMemoryDiagrams.set(id, row); // Cache locally
        // Touch last_accessed_at asynchronously
        sql`UPDATE shared_diagrams SET last_accessed_at = NOW() WHERE id = ${id}`.catch(() => {});
        return row;
      }
    } catch (err) {
      log('warn', 'Failed to fetch diagram from Neon; falling back to in-memory cache', {
        id,
        error: String(err),
      });
    }
  }

  // Fallback to in-memory store
  const inMemory = inMemoryDiagrams.get(id);
  if (inMemory) {
    inMemory.lastAccessedAt = new Date().toISOString();
    return inMemory;
  }
  return null;
}

export async function cleanupOldDiagrams(retentionDays = 90): Promise<number> {
  let deletedCount = 0;
  const cutoffTime = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const cutoff = new Date(cutoffTime).toISOString();

  // Clean in-memory entries
  for (const [id, diagram] of inMemoryDiagrams.entries()) {
    const lastAccessedAt = diagram.lastAccessedAt ?? diagram.createdAt;
    if (Date.parse(lastAccessedAt) < cutoffTime) {
      inMemoryDiagrams.delete(id);
      deletedCount++;
    }
  }

  // Clean Neon database entries
  const sql = getSql();
  if (sql) {
    try {
      await initDbSchema();
      const result = await sql`
        DELETE FROM shared_diagrams
        WHERE COALESCE(last_accessed_at, created_at) < NOW() - (${retentionDays} * INTERVAL '1 day')
        RETURNING id;
      `;
      const rows = result as unknown as { id: string }[];
      if (Array.isArray(rows)) {
        deletedCount = Math.max(deletedCount, rows.length);
      }
    } catch (err) {
      log('warn', 'Failed to run database diagram retention cleanup', { error: String(err) });
    }
  }

  log('info', 'Diagram retention cleanup completed', { retentionDays, deletedCount });
  return deletedCount;
}
