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
  const createdAt = event.createdAt instanceof Date ? new Date(event.createdAt) : new Date(event.createdAt ?? Date.now());
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

export class InMemoryOperationalEventRepository extends OperationalEventRepository {
  #events = [];

  async append(event) {
    const record = normalize(event);
    this.#events.push(record);
    return { ...record, details: { ...record.details }, createdAt: new Date(record.createdAt) };
  }

  async findByExecutionId(executionId, limit = 100) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new RangeError('limit deve ficar entre 1 e 500.');
    return this.#events
      .filter((event) => event.executionId === executionId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
      .map((event) => ({ ...event, details: { ...event.details }, createdAt: new Date(event.createdAt) }));
  }

  async countSince(since) {
    const cutoff = since instanceof Date ? since : new Date(since);
    if (Number.isNaN(cutoff.getTime())) throw new TypeError('since deve ser uma data válida.');
    const selected = this.#events.filter((event) => event.createdAt >= cutoff);
    const byType = {};
    const bySeverity = {};
    for (const event of selected) {
      byType[event.eventType] = (byType[event.eventType] ?? 0) + 1;
      bySeverity[event.severity] = (bySeverity[event.severity] ?? 0) + 1;
    }
    return { total: selected.length, byType, bySeverity };
  }
}
