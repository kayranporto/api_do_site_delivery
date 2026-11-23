import { readFile } from 'node:fs/promises';

export const POSTGRES_SCHEMA_VERSION = '005_api_client_lifecycle';
const MIGRATION_LOCK_ID = '520260519';
const MIGRATIONS = [
  { version: '001_initial_schema', file: '../../../database/migrations/001_initial_schema.sql' },
  { version: '002_execution_interrupted', file: '../../../database/migrations/002_execution_interrupted.sql' },
  { version: '003_operational_events', file: '../../../database/migrations/003_operational_events.sql' },
  { version: '004_api_clients', file: '../../../database/migrations/004_api_clients.sql' },
  { version: '005_api_client_lifecycle', file: '../../../database/migrations/005_api_client_lifecycle.sql' }
];

export async function runMigrations(pool) {
  if (!pool || typeof pool.connect !== 'function') {
    throw new TypeError('pool PostgreSQL com connect() é obrigatório para migrations.');
  }
  const client = await pool.connect();
  const appliedVersions = [];
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [MIGRATION_LOCK_ID]);
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())'
    );

    for (const migration of MIGRATIONS) {
      const applied = await client.query('SELECT version FROM schema_migrations WHERE version = $1', [migration.version]);
      if (applied.rows.length > 0) continue;
      const migrationSql = await readFile(new URL(migration.file, import.meta.url), 'utf8');
      await client.query(migrationSql);
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [migration.version]);
      appliedVersions.push(migration.version);
    }

    await client.query('COMMIT');
    return {
      version: POSTGRES_SCHEMA_VERSION,
      applied: appliedVersions.length > 0,
      appliedVersions
    };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* preserva o erro original */ }
    throw new Error('Não foi possível aplicar as migrations PostgreSQL.', { cause: error });
  } finally {
    client.release();
  }
}

export async function migratePostgresDatabase({ connectionString, max = 1 } = {}) {
  if (typeof connectionString !== 'string' || connectionString.trim() === '') {
    throw new TypeError('DATABASE_URL é obrigatório para executar migrations.');
  }
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString, max, connectionTimeoutMillis: 5_000, idleTimeoutMillis: 10_000 });
  try {
    return await runMigrations(pool);
  } finally {
    await pool.end();
  }
}
