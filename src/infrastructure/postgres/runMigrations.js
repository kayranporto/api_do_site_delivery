import { readFile } from 'node:fs/promises';

export const POSTGRES_SCHEMA_VERSION = '001_initial_schema';
const MIGRATION_LOCK_ID = '520260519';

export async function runMigrations(pool) {
  if (!pool || typeof pool.connect !== 'function') {
    throw new TypeError('pool PostgreSQL com connect() é obrigatório para migrations.');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [MIGRATION_LOCK_ID]);
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())'
    );

    const applied = await client.query(
      'SELECT version FROM schema_migrations WHERE version = $1',
      [POSTGRES_SCHEMA_VERSION]
    );
    if (applied.rows.length > 0) {
      await client.query('COMMIT');
      return { version: POSTGRES_SCHEMA_VERSION, applied: false };
    }

    const migrationUrl = new URL('../../../database/migrations/001_initial_schema.sql', import.meta.url);
    const migrationSql = await readFile(migrationUrl, 'utf8');
    await client.query(migrationSql);
    await client.query(
      'INSERT INTO schema_migrations (version) VALUES ($1)',
      [POSTGRES_SCHEMA_VERSION]
    );
    await client.query('COMMIT');
    return { version: POSTGRES_SCHEMA_VERSION, applied: true };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* preserva o erro original */ }
    throw new Error('Não foi possível aplicar a migration PostgreSQL.', { cause: error });
  } finally {
    client.release();
  }
}

export async function migratePostgresDatabase({ connectionString, max = 1 } = {}) {
  if (typeof connectionString !== 'string' || connectionString.trim() === '') {
    throw new TypeError('DATABASE_URL é obrigatório para executar migrations.');
  }
  const { Pool } = await import('pg');
  const pool = new Pool({
    connectionString,
    max,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 10_000
  });
  try {
    return await runMigrations(pool);
  } finally {
    await pool.end();
  }
}
