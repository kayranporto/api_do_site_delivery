import { ExecutionRepository } from '../../domain/ports/ExecutionRepository.js';
import { Execution, ExecutionStatus } from '../../domain/entities/Execution.js';

function idempotencyIndex(integrationId, key) {
  return integrationId + '\u0000' + key;
}

/** Adaptador volátil para testes e desenvolvimento local. Não usar como persistência de produção. */
export class InMemoryExecutionRepository extends ExecutionRepository {
  #records = new Map();
  #idempotency = new Map();
  #leases = new Map();

  async save(execution) {
    const record = structuredClone(execution.toJSON());
    const key = record.idempotencyKey == null
      ? null
      : idempotencyIndex(record.integrationId, record.idempotencyKey);
    const owner = key ? this.#idempotency.get(key) : null;

    if (owner && owner !== record.id) {
      const error = new Error('Chave de idempotência já registrada para esta integração.');
      error.code = 'IDEMPOTENCY_KEY_CONFLICT';
      throw error;
    }

    this.#records.set(record.id, record);
    if (key) this.#idempotency.set(key, record.id);
    this.#leases.delete(record.id);
    return Execution.reconstitute(record);
  }

  async createIfAbsent(execution) {
    const record = structuredClone(execution.toJSON());
    const key = record.idempotencyKey == null
      ? null
      : idempotencyIndex(record.integrationId, record.idempotencyKey);

    if (key) {
      const owner = this.#idempotency.get(key);
      if (owner) {
        const existing = this.#records.get(owner);
        return { execution: Execution.reconstitute(structuredClone(existing)), created: false };
      }
      // A reserva ocorre antes de qualquer await: chamadas concorrentes no mesmo processo
      // não conseguem observar a chave como livre depois deste ponto.
      this.#idempotency.set(key, record.id);
    }

    this.#records.set(record.id, record);
    return { execution: Execution.reconstitute(structuredClone(record)), created: true };
  }

  async findById(executionId) {
    const record = this.#records.get(executionId);
    return record ? Execution.reconstitute(structuredClone(record)) : null;
  }

  async findByIdempotencyKey(integrationId, key) {
    const id = this.#idempotency.get(idempotencyIndex(integrationId, key));
    return id ? this.findById(id) : null;
  }

  async findDueForRetry(now, limit) {
    const reference = now instanceof Date ? now : new Date(now);
    if (Number.isNaN(reference.getTime())) throw new TypeError('now deve ser uma data válida.');
    if (!Number.isInteger(limit) || limit < 1) throw new TypeError('limit deve ser um inteiro positivo.');

    return [...this.#records.values()]
      .filter((record) => record.status === ExecutionStatus.RETRY_SCHEDULED
        && record.nextAttemptAt != null
        && new Date(record.nextAttemptAt) <= reference)
      .sort((a, b) => new Date(a.nextAttemptAt) - new Date(b.nextAttemptAt))
      .slice(0, limit)
      .map((record) => Execution.reconstitute(structuredClone(record)));
  }

  async claimDueForRetry(now, limit, leaseMs = 180_000) {
    const reference = now instanceof Date ? new Date(now) : new Date(now);
    if (Number.isNaN(reference.getTime())) throw new TypeError('now deve ser uma data válida.');
    if (!Number.isInteger(limit) || limit < 1) throw new TypeError('limit deve ser um inteiro positivo.');
    if (!Number.isInteger(leaseMs) || leaseMs < 1 || leaseMs > 900_000) {
      throw new TypeError('leaseMs deve ser um inteiro entre 1 e 900000.');
    }

    const leaseUntil = reference.getTime() + leaseMs;
    const due = [...this.#records.values()]
      .filter((record) => record.status === ExecutionStatus.RETRY_SCHEDULED
        && record.nextAttemptAt != null
        && new Date(record.nextAttemptAt) <= reference
        && (this.#leases.get(record.id) ?? 0) <= reference.getTime())
      .sort((a, b) => new Date(a.nextAttemptAt) - new Date(b.nextAttemptAt))
      .slice(0, limit);

    for (const record of due) this.#leases.set(record.id, leaseUntil);
    return due.map((record) => Execution.reconstitute(structuredClone(record)));
  }
}
