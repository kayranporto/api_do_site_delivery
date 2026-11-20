import { randomUUID } from 'node:crypto';
import { ExecutionRepository } from '../../domain/ports/ExecutionRepository.js';
import { Execution, ExecutionStatus } from '../../domain/entities/Execution.js';

function jsonValue(value) { return typeof value === 'string' ? JSON.parse(value) : value; }
function reconstitute(row) {
  return Execution.reconstitute({
    id: row.id, integrationId: row.integration_id, operationName: row.operation_name,
    input: jsonValue(row.input), idempotencyKey: row.idempotency_key,
    retryPolicy: jsonValue(row.retry_policy), status: row.status, attempts: jsonValue(row.attempts),
    nextAttemptAt: row.next_attempt_at, completedAt: row.completed_at, createdAt: row.created_at
  });
}
function valuesFor(execution) {
  const r = execution.toJSON();
  return [r.id, r.integrationId, r.operationName, JSON.stringify(r.input), r.idempotencyKey,
    JSON.stringify(r.retryPolicy), r.status, r.attempts.length, JSON.stringify(r.attempts),
    r.nextAttemptAt, r.completedAt, r.createdAt];
}
const INSERT_SQL = [
  'INSERT INTO executions (id, integration_id, operation_name, input, idempotency_key, retry_policy,',
  'status, attempt_count, attempts, next_attempt_at, completed_at, created_at)',
  'VALUES ($1, $2, $3, $4::jsonb, $5, $6::jsonb, $7, $8, $9::jsonb, $10, $11, $12)'
].join(' ');
const UPSERT_SQL = INSERT_SQL + ' ON CONFLICT (id) DO UPDATE SET ' + [
  'operation_name = EXCLUDED.operation_name, input = EXCLUDED.input,',
  'retry_policy = EXCLUDED.retry_policy, status = EXCLUDED.status,',
  'attempt_count = EXCLUDED.attempt_count, attempts = EXCLUDED.attempts,',
  'next_attempt_at = EXCLUDED.next_attempt_at, completed_at = EXCLUDED.completed_at,',
  'lease_token = NULL, lease_until = NULL WHERE executions.lease_token IS NULL RETURNING *'
].join(' ');
function fail(code, message) { const e = new Error(message); e.code = code; return e; }
function validateLeaseMs(ms) {
  if (!Number.isInteger(ms) || ms < 1 || ms > 900_000) throw new TypeError('leaseMs deve ser um inteiro entre 1 e 900000.');
}
function mapUniqueConflict(error) {
  if (error?.code === '23505' && error?.constraint === 'executions_integration_id_idempotency_key_uidx') {
    return fail('IDEMPOTENCY_KEY_CONFLICT', 'Chave de idempotência já registrada.');
  }
  return error;
}

/** Adaptador PostgreSQL com fencing token para impedir gravações de workers atrasados. */
export class PostgresExecutionRepository extends ExecutionRepository {
  #leaseOwners = new WeakMap();

  constructor({ pool }) {
    super();
    if (!pool || typeof pool.query !== 'function') throw new TypeError('pool PostgreSQL é obrigatório.');
    this.pool = pool;
  }

  async save(execution, { releaseLease = true } = {}) {
    const token = this.#leaseOwners.get(execution);
    if (token) {
      const sql = 'UPDATE executions SET operation_name=$3, input=$4::jsonb, retry_policy=$6::jsonb, ' +
        'status=$7, attempt_count=$8, attempts=$9::jsonb, next_attempt_at=$10, completed_at=$11, ' +
        'lease_token=' + (releaseLease ? 'NULL' : '$13') + ', lease_until=' +
        (releaseLease ? 'NULL' : 'lease_until') + ' WHERE id=$1 AND lease_token=$13 RETURNING *';
      const result = await this.pool.query(sql, [...valuesFor(execution), token]);
      if (!result.rows[0]) throw fail('EXECUTION_LEASE_LOST', 'O lease da execução foi perdido.');
      if (releaseLease) this.#leaseOwners.delete(execution);
      return reconstitute(result.rows[0]);
    }
    try {
      const result = await this.pool.query(UPSERT_SQL, valuesFor(execution));
      if (!result.rows[0]) throw fail('EXECUTION_LEASE_ACTIVE', 'A execução está sendo processada por outro worker.');
      return reconstitute(result.rows[0]);
    } catch (error) { throw mapUniqueConflict(error); }
  }

  async createIfAbsent(execution) {
    const r = execution.toJSON();
    if (r.idempotencyKey == null) return { execution: await this.save(execution), created: true };
    try {
      const result = await this.pool.query(
        INSERT_SQL + ' ON CONFLICT (integration_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING RETURNING *',
        valuesFor(execution)
      );
      if (result.rows[0]) return { execution: reconstitute(result.rows[0]), created: true };
      const existing = await this.findByIdempotencyKey(r.integrationId, r.idempotencyKey);
      if (!existing) throw new Error('A reserva de idempotência não pôde ser recuperada.');
      return { execution: existing, created: false };
    } catch (error) { throw mapUniqueConflict(error); }
  }

  async findById(id) {
    const result = await this.pool.query('SELECT * FROM executions WHERE id=$1', [id]);
    return result.rows[0] ? reconstitute(result.rows[0]) : null;
  }

  async findByIdempotencyKey(integrationId, key) {
    const result = await this.pool.query(
      'SELECT * FROM executions WHERE integration_id=$1 AND idempotency_key=$2', [integrationId, key]
    );
    return result.rows[0] ? reconstitute(result.rows[0]) : null;
  }

  async acquireLease(execution, leaseMs = 180_000) {
    validateLeaseMs(leaseMs);
    const token = randomUUID();
    const result = await this.pool.query(
      "UPDATE executions SET lease_token=$2, lease_until=NOW()+($3::integer * INTERVAL '1 millisecond') " +
      "WHERE id=$1 AND status='pending' AND (lease_until IS NULL OR lease_until<=NOW()) RETURNING id",
      [execution.id, token, leaseMs]
    );
    if (!result.rows.length) return false;
    this.#leaseOwners.set(execution, token);
    return true;
  }

  async renewLease(execution, leaseMs = 180_000) {
    validateLeaseMs(leaseMs);
    const token = this.#leaseOwners.get(execution);
    if (!token) return false;
    const result = await this.pool.query(
      "UPDATE executions SET lease_until=NOW()+($3::integer * INTERVAL '1 millisecond') " +
      "WHERE id=$1 AND lease_token=$2 AND lease_until>NOW() RETURNING id",
      [execution.id, token, leaseMs]
    );
    return result.rows.length > 0;
  }

  async findDueForRetry(now, limit) {
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new TypeError('now deve ser uma data válida.');
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new TypeError('limit inválido.');
    const result = await this.pool.query(
      'SELECT * FROM executions WHERE status=$1 AND next_attempt_at<=$2 ORDER BY next_attempt_at,created_at LIMIT $3',
      [ExecutionStatus.RETRY_SCHEDULED, now, limit]
    );
    return result.rows.map(reconstitute);
  }

  async claimDueForRetry(now, limit, leaseMs = 180_000) {
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new TypeError('now deve ser uma data válida.');
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new TypeError('limit inválido.');
    validateLeaseMs(leaseMs);
    const token = randomUUID();
    const sql = [
      'WITH due AS (SELECT id FROM executions WHERE status=$1 AND next_attempt_at<=$2',
      'AND (lease_until IS NULL OR lease_until<=NOW()) ORDER BY next_attempt_at,created_at',
      'LIMIT $3 FOR UPDATE SKIP LOCKED)',
      "UPDATE executions AS e SET lease_token=$4, lease_until=NOW()+($5::integer * INTERVAL '1 millisecond')",
      'FROM due WHERE e.id=due.id RETURNING e.*'
    ].join(' ');
    const result = await this.pool.query(sql, [ExecutionStatus.RETRY_SCHEDULED, now, limit, token, leaseMs]);
    return result.rows.map((row) => {
      const execution = reconstitute(row);
      this.#leaseOwners.set(execution, row.lease_token);
      return execution;
    });
  }

  async claimStaleExecutions(cutoff, now, limit, leaseMs = 180_000) {
    if (!(cutoff instanceof Date) || Number.isNaN(cutoff.getTime())) throw new TypeError('cutoff inválido.');
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new TypeError('now inválido.');
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new TypeError('limit inválido.');
    validateLeaseMs(leaseMs);
    const token = randomUUID();
    const sql = [
      'WITH stale AS (SELECT id FROM executions WHERE',
      "((status='pending' AND created_at<=$1) OR (status='running' AND (attempts -> -1 ->> 'startedAt')::timestamptz<=$1))",
      'AND (lease_until IS NULL OR lease_until<=NOW()) ORDER BY created_at LIMIT $2 FOR UPDATE SKIP LOCKED)',
      "UPDATE executions AS e SET lease_token=$3, lease_until=NOW()+($4::integer * INTERVAL '1 millisecond')",
      'FROM stale WHERE e.id=stale.id RETURNING e.*'
    ].join(' ');
    const result = await this.pool.query(sql, [cutoff, limit, token, leaseMs]);
    return result.rows.map((row) => {
      const execution = reconstitute(row);
      this.#leaseOwners.set(execution, row.lease_token);
      return execution;
    });
  }
}
