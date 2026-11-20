import { PostgresExecutionRepository } from '../repositories/PostgresExecutionRepository.js';
import { PostgresIntegrationRepository } from '../repositories/PostgresIntegrationRepository.js';
import { POSTGRES_SCHEMA_VERSION } from './runMigrations.js';

/** Abre o pool e verifica o schema. Não executa migrations automaticamente. */
export async function createPostgresPersistence({ connectionString, max = 10 } = {}) {
  if (typeof connectionString !== 'string' || connectionString.trim() === '') {
    throw new TypeError('DATABASE_URL é obrigatório para persistência PostgreSQL.');
  }
  if (!Number.isInteger(max) || max < 1 || max > 50) {
    throw new RangeError('DATABASE_POOL_MAX deve ser um inteiro entre 1 e 50.');
  }

  const { Pool } = await import('pg');
  const pool = new Pool({
    connectionString,
    max,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000
  });

  try {
    const result = await pool.query(
      'SELECT version FROM schema_migrations WHERE version = $1',
      [POSTGRES_SCHEMA_VERSION]
    );
    if (result.rows.length === 0) {
      throw new Error('Schema PostgreSQL ausente ou desatualizado. Execute npm run db:migrate.');
    }
  } catch (error) {
    await pool.end();
    if (error?.code === '42P01') {
      throw new Error('Schema PostgreSQL ainda não foi criado. Execute npm run db:migrate.', { cause: error });
    }
    if (error?.message?.includes('npm run db:migrate')) throw error;
    throw new Error('Não foi possível validar a conexão e o schema PostgreSQL.', { cause: error });
  }

  return {
    pool,
    repositories: {
      integration: new PostgresIntegrationRepository({ pool }),
      execution: new PostgresExecutionRepository({ pool })
    },
    close: () => pool.end()
  };
}
