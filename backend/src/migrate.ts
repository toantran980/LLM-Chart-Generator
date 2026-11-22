import 'dotenv/config';
import { neon } from '@neondatabase/serverless';
import { getDatabaseUrl } from './db';
import { log } from './logger';

export async function runMigrations(): Promise<void> {
  const url = getDatabaseUrl();
  if (!url) {
    log('info', 'No database configured (POSTGRES_URL/DATABASE_URL unset); skipping migrations.');
    return;
  }

  const sql = neon(url);
  log('info', 'Connecting to database to run migrations...');

  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(64) PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;

  const appliedRows = (await sql`SELECT version FROM schema_migrations;`) as unknown as { version: string }[];
  const applied = new Set((appliedRows || []).map((r) => r.version));

  const migrations: { version: string; run: () => Promise<void> }[] = [
    {
      version: '001_initial_schema',
      run: async () => {
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
      },
    },
    {
      version: '002_add_last_accessed_at',
      run: async () => {
        await sql`
          ALTER TABLE shared_diagrams
          ADD COLUMN IF NOT EXISTS last_accessed_at TIMESTAMPTZ DEFAULT NOW();
        `;
      },
    },
  ];

  for (const migration of migrations) {
    if (!applied.has(migration.version)) {
      log('info', `Applying migration ${migration.version}...`);
      await migration.run();
      await sql`INSERT INTO schema_migrations (version) VALUES (${migration.version});`;
      log('info', `Migration ${migration.version} applied successfully.`);
    } else {
      log('info', `Migration ${migration.version} already applied.`);
    }
  }

  log('info', 'All database migrations finished successfully.');
}

if (require.main === module) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((err) => {
      log('error', 'Migration failed', { error: String(err) });
      process.exit(1);
    });
}
