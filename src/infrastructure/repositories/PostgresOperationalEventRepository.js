import { randomUUID } from 'node:crypto';
import { OperationalEventRepository } from '../../application/ports/OperationalEventRepository.js';

const EVENT_TYPES = new Set([
  'execution.attempt_started',
  'execution.attempt_succeeded',
  'execution.attempt_failed',
  'execution.retry_cancelled',
  'execution.interrupted',
  'execution.reconciliation_requested',
  'execution.reconciliation_completed',
  'execution.reconciliation_unsupported',
  'execution.reconciliation_failed'
]);
const SEVERITIES = new Set(['info', 'warning', 'error']);
const DETAIL_KEYS = new Set([
  'attempt', 'errorCode', 'retryable', 'status', 'outcome',
  'providerStatus', 'reason', 'durationMs'
]);

function normalize(event) {
  if (!event || typeof event !== 'object') throw new TypeError('event é obrigatório.');
  if (typeof event.executionId !== 'string' || !event.executionId) throw new TypeError('executionId é obrigatório.');
  if (typeof event.integrationId !== 'string' || !event.integrationId) throw new TypeError('integrationId é obrigatório.');
  if (!EVENT_TYPES.has(event.eventType)) throw new TypeError('eventType não permitido.');
  const severity = event.severity ?? 'info';
  if (!SEVERITIES.has(severity)) throw new TypeError('severity inválida.');
  const details = {};
  for (const [key, value] of Object.entries(event.details ?? {})) {
    if (!DETAIL_KEYS.has(key)) continue;
    if (typeof value === 'string') details[key] = value.slice(0, 120);
    else if (typeof value === 'number' && Number.isFinite(value)) details[key] = value;
    else if (typeof value === 'boolean') details[key] = value;
  }
  const createdAt = event.createdAt instanceof Date ? event.createdAt : new Date(event.createdAt ?? Date.now());
  if (Number.isNaN(createdAt.getTime())) throw new TypeError('createdAt inválido.');
  return {
    id: event.id ?? randomUUID(),
    executionId: event.executionId,
    integrationId: event.integrationId,
    eventType: event.eventType,
    severity,
    details,
    createdAt
  };
}

function mapRow(row) {
  return {
    id: row.id,
    executionId: row.execution_id,
    integrationId: row.integration_id,
    eventType: row.event_type,
    severity: row.severity,
    details: typeof row.details === 'string' ? JSON.parse(row.details) : row.details,
    createdAt: new Date(row.created_at)
  };
}

export class PostgresOperationalEventRepository extends OperationalEventRepository {
  constructor({ pool }) {
    super();
    if (!pool || typeof pool.query !== 'function') throw new TypeError('pool PostgreSQL é obrigatório.');
    this.pool = pool;
  }

  async append(event) {
    const record = normalize(event);
    const sql = [
      'INSERT INTO execution_events',
      '(id, execution_id, integration_id, event_type, severity, details, created_at)',
      'VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7) RETURNING *'
    ].join(' ');
    const result = await this.pool.query(sql, [
      record.id, record.executionId, record.integrationId, record.eventType,
      record.severity, JSON.stringify(record.details), record.createdAt
    ]);
    return mapRow(result.rows[0]);
  }

  async findByExecutionId(executionId, limit = 100) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new RangeError('limit deve ficar entre 1 e 500.');
    const result = await this.pool.query(
      'SELECT * FROM execution_events WHERE execution_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2',
      [executionId, limit]
    );
    return result.rows.map(mapRow);
  }

  async countSince(since) {
    const cutoff = since instanceof Date ? since : new Date(since);
    if (Number.isNaN(cutoff.getTime())) throw new TypeError('since deve ser uma data válida.');
    const [total, byType, bySeverity] = await Promise.all([
      this.pool.query('SELECT COUNT(*)::integer AS total FROM execution_events WHERE created_at >= $1', [cutoff]),
      this.pool.query('SELECT event_type, COUNT(*)::integer AS count FROM execution_events WHERE created_at >= $1 GROUP BY event_type', [cutoff]),
      this.pool.query('SELECT severity, COUNT(*)::integer AS count FROM execution_events WHERE created_at >= $1 GROUP BY severity', [cutoff])
    ]);
    return {
      total: total.rows[0]?.total ?? 0,
      byType: Object.fromEntries(byType.rows.map((row) => [row.event_type, row.count])),
      bySeverity: Object.fromEntries(bySeverity.rows.map((row) => [row.severity, row.count]))
    };
  }
}
