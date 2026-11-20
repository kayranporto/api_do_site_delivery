import { randomUUID } from 'node:crypto';
import { ExecutionRepository } from '../../domain/ports/ExecutionRepository.js';
import { Execution, ExecutionStatus } from '../../domain/entities/Execution.js';

function jsonValue(value) {
  if (typeof value === 'string') return JSON.parse(value);
  return value;
}

function reconstitute(row) {
  return Execution.reconstitute({
    id: row.id,
    integrationId: row.integration_id,
    operationName: row.operation_name,
    input: jsonValue(row.input),
    idempotencyKey: row.idempotency_key,
    retryPolicy: jsonValue(row.retry_policy),
    status: row.status,
    attempts: jsonValue(row.attempts),
    nextAttemptAt: row.next_attempt_at,
    completedAt: row.completed_at,
    createdAt: row.created_at
  });
}

function valuesFor(execution) {
  const record = execution.toJSON();
  return [
    record.id,
    record.integrationId,
    record.operationName,
    JSON.stringify(record.input),
    record.idempotencyKey,
    JSON.stringify(record.retryPolicy),
    record.status,
    record.attempts.length,
    JSON.stringify(record.attempts),
    record.nextAttemptAt,
    record.completedAt,
    record.createdAt
  ];
}

const INSERT_SQL = [
  'INSERT INTO executions (',
  'id, integration_id, operation_name, input, idempotency_key, retry_policy,',
  'status, attempt_count, attempts, next_attempt_at, completed_at, created_at',
  ') VALUES ($1, $2, $3, $4::jsonb, $5, $6::jsonb, $7, $8, $9::jsonb, $10, $11, $12)'
].join(' ');

const UPSERT_SQL = INSERT_SQL + ' ' + [
  'ON CONFLICT (id) DO UPDATE SET',
  'operation_name = EXCLUDED.operation_name, input = EXCLUDED.input,',
  'retry_policy = EXCLUDED.retry_policy, status = EXCLUDED.status,',
  'attempt_count = EXCLUDED.attempt_count, attempts = EXCLUDED.attempts,',
  'next_attempt_at = EXCLUDED.next_attempt_at, completed_at = EXCLUDED.completed_at,',
  'lease_token = NULL, lease_until = NULL RETURNING *'
].join(' ');

function mapUniqueConflict(error) {
  if (error?.code === '23505' && error?.constraint === 'executions_integration_id_idempotency_key_uidx') {
    const conflict = new Error('Chave de idempotência já registrada para esta integração.');
    conflict.code = 'IDEMPOTENCY_KEY_CONFLICT';
    return conflict;
  }
  return error;
}

/** Adaptador durável. A reserva de idempotência e a reivindicação de retries são atômicas no PostgreSQL. */
export class PostgresExecutionRepository extends ExecutionRepository {
  constructor({ pool }) {
    super();
    if (!pool || typeof pool.query !== 'function') throw new TypeError('pool PostgreSQL é obrigatório.');
    this.pool = pool;
  }

  async save(execution) {
    try {
      const result = await this.pool.query(UPSERT_SQL, valuesFor(execution));
      return reconstitute(result.rows[0]);
    } catch (error) {
      throw mapUniqueConflict(error);
    }
  }

  async createIfAbsent(execution) {
    const record = execution.toJSON();
    if (record.idempotencyKey == null) {
      return { execution: await this.save(execution), created: true };
    }

    try {
      const result = await this.pool.query(
        INSERT_SQL + ' ON CONFLICT (integration_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING RETURNING *',
        valuesFor(execution)
      );

      if (result.rows[0]) return { execution: reconstitute(result.rows[0]), created: true };
      const existing = await this.findByIdempotencyKey(record.integrationId, record.idempotencyKey);
      if (!existing) throw new Error('A reserva de idempotência não pôde ser recuperada.');
      return { execution: existing, created: false };
    } catch (error) {
      throw mapUniqueConflict(error);
    }
  }

  async findById(executionId) {
    const result = await this.pool.query('SELECT * FROM executions WHERE id = $1', [executionId]);
    return result.rows[0] ? reconstitute(result.rows[0]) : null;
  }

  async findByIdempotencyKey(integrationId, idempotencyKey) {
    const result = await this.pool.query(
      'SELECT * FROM executions WHERE integration_id = $1 AND idempotency_key = $2',
      [integrationId, idempotencyKey]
    );
    return result.rows[0] ? reconstitute(result.rows[0]) : null;
  }

  async findDueForRetry(now, limit) {
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new TypeError('now deve ser uma data válida.');
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new TypeError('limit deve ser um inteiro entre 1 e 100.');

    const result = await this.pool.query(
      'SELECT * FROM executions WHERE status = $1 AND next_attempt_at <= $2 ORDER BY next_attempt_at ASC, created_at ASC LIMIT $3',
      [ExecutionStatus.RETRY_SCHEDULED, now, limit]
    );
    return result.rows.map(reconstitute);
  }

  async claimDueForRetry(now, limit, leaseMs = 180_000) {
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new TypeError('now deve ser uma data válida.');
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new TypeError('limit deve ser um inteiro entre 1 e 100.');
    if (!Number.isInteger(leaseMs) || leaseMs < 1 || leaseMs > 900_000) {
      throw new TypeError('leaseMs deve ser um inteiro entre 1 e 900000.');
    }

    const leaseToken = randomUUID();
    const sql = [
      'WITH due AS (',
      'SELECT id FROM executions',
      'WHERE status = $1 AND next_attempt_at <= $2',
      'AND (lease_until IS NULL OR lease_until <= $2)',
      'ORDER BY next_attempt_at ASC, created_at ASC LIMIT $3 FOR UPDATE SKIP LOCKED',
      ')',
      'UPDATE executions AS execution',
      "SET lease_token = $4, lease_until = $2::timestamptz + ($5::integer * INTERVAL '1 millisecond')",
      'FROM due WHERE execution.id = due.id RETURNING execution.*'
    ].join(' ');
    const result = await this.pool.query(sql, [
      ExecutionStatus.RETRY_SCHEDULED,
      now,
      limit,
      leaseToken,
      leaseMs
    ]);
    return result.rows.map(reconstitute);
  }
}
