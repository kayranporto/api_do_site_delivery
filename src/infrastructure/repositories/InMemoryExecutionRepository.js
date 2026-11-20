import { randomUUID } from 'node:crypto';
import { ExecutionRepository } from '../../domain/ports/ExecutionRepository.js';
import { Execution, ExecutionStatus } from '../../domain/entities/Execution.js';

function idempotencyIndex(integrationId, key) {
  return integrationId + '\u0000' + key;
}
function failure(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/** Adaptador volátil para testes e desenvolvimento local. Não usar como persistência de produção. */
export class InMemoryExecutionRepository extends ExecutionRepository {
  #records = new Map();
  #idempotency = new Map();
  #leases = new Map();
  #leaseOwners = new WeakMap();

  async save(execution, { releaseLease = true } = {}) {
    const record = structuredClone(execution.toJSON());
    const key = record.idempotencyKey == null ? null : idempotencyIndex(record.integrationId, record.idempotencyKey);
    const owner = key ? this.#idempotency.get(key) : null;
    if (owner && owner !== record.id) throw failure('IDEMPOTENCY_KEY_CONFLICT', 'Chave de idempotência já registrada.');

    const token = this.#leaseOwners.get(execution);
    const lease = this.#leases.get(record.id);
    if (token) {
      if (!lease || lease.token !== token) throw failure('EXECUTION_LEASE_LOST', 'O lease da execução foi perdido.');
      if (releaseLease) {
        this.#leases.delete(record.id);
        this.#leaseOwners.delete(execution);
      }
    } else if (lease && lease.until > Date.now()) {
      throw failure('EXECUTION_LEASE_ACTIVE', 'A execução está sendo processada por outro worker.');
    } else if (lease) {
      this.#leases.delete(record.id);
    }

    this.#records.set(record.id, record);
    if (key) this.#idempotency.set(key, record.id);
    return Execution.reconstitute(record);
  }

  async createIfAbsent(execution) {
    const record = structuredClone(execution.toJSON());
    const key = record.idempotencyKey == null ? null : idempotencyIndex(record.integrationId, record.idempotencyKey);
    if (key) {
      const owner = this.#idempotency.get(key);
      if (owner) return { execution: Execution.reconstitute(structuredClone(this.#records.get(owner))), created: false };
      this.#idempotency.set(key, record.id);
    }
    this.#records.set(record.id, record);
    return { execution: Execution.reconstitute(structuredClone(record)), created: true };
  }

  async findById(id) {
    const record = this.#records.get(id);
    return record ? Execution.reconstitute(structuredClone(record)) : null;
  }

  async findByIdempotencyKey(integrationId, key) {
    const id = this.#idempotency.get(idempotencyIndex(integrationId, key));
    return id ? this.findById(id) : null;
  }

  async acquireLease(execution, leaseMs = 180_000) {
    if (!Number.isInteger(leaseMs) || leaseMs < 1 || leaseMs > 900_000) throw new TypeError('leaseMs inválido.');
    const current = this.#leases.get(execution.id);
    if (current && current.until > Date.now()) return false;
    const token = randomUUID();
    this.#leases.set(execution.id, { token, until: Date.now() + leaseMs });
    this.#leaseOwners.set(execution, token);
    return true;
  }

  async renewLease(execution, leaseMs = 180_000) {
    const token = this.#leaseOwners.get(execution);
    const current = this.#leases.get(execution.id);
    if (!token || !current || current.token !== token || current.until <= Date.now()) return false;
    if (!Number.isInteger(leaseMs) || leaseMs < 1 || leaseMs > 900_000) return false;
    current.until = Date.now() + leaseMs;
    return true;
  }

  async findDueForRetry(now, limit) {
    const reference = now instanceof Date ? now : new Date(now);
    if (Number.isNaN(reference.getTime())) throw new TypeError('now deve ser uma data válida.');
    if (!Number.isInteger(limit) || limit < 1) throw new TypeError('now/limit inválidos.');
    return [...this.#records.values()]
      .filter((r) => r.status === ExecutionStatus.RETRY_SCHEDULED && r.nextAttemptAt != null
        && new Date(r.nextAttemptAt) <= reference)
      .sort((a, b) => new Date(a.nextAttemptAt) - new Date(b.nextAttemptAt))
      .slice(0, limit).map((r) => Execution.reconstitute(structuredClone(r)));
  }

  async claimDueForRetry(now, limit, leaseMs = 180_000) {
    const reference = now instanceof Date ? now : new Date(now);
    if (Number.isNaN(reference.getTime())) throw new TypeError('now deve ser uma data válida.');
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new TypeError('limit inválido.');
    if (!Number.isInteger(leaseMs) || leaseMs < 1 || leaseMs > 900_000) throw new TypeError('leaseMs inválido.');
    const due = [...this.#records.values()]
      .filter((r) => r.status === ExecutionStatus.RETRY_SCHEDULED && r.nextAttemptAt != null
        && new Date(r.nextAttemptAt) <= reference
        && (this.#leases.get(r.id)?.until ?? 0) <= reference.getTime())
      .sort((a, b) => new Date(a.nextAttemptAt) - new Date(b.nextAttemptAt)).slice(0, limit);
    return due.map((record) => {
      const execution = Execution.reconstitute(structuredClone(record));
      const token = randomUUID();
      this.#leases.set(record.id, { token, until: reference.getTime() + leaseMs });
      this.#leaseOwners.set(execution, token);
      return execution;
    });
  }

  async claimStaleExecutions(cutoff, now, limit, leaseMs = 180_000) {
    const staleBefore = cutoff instanceof Date ? cutoff : new Date(cutoff);
    const reference = now instanceof Date ? now : new Date(now);
    if (Number.isNaN(staleBefore.getTime()) || Number.isNaN(reference.getTime())) throw new TypeError('Datas inválidas.');
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new TypeError('limit inválido.');
    if (!Number.isInteger(leaseMs) || leaseMs < 1 || leaseMs > 900_000) throw new TypeError('leaseMs inválido.');
    const stale = [...this.#records.values()].filter((record) => {
      if (![ExecutionStatus.PENDING, ExecutionStatus.RUNNING].includes(record.status)) return false;
      const lease = this.#leases.get(record.id);
      if (lease && lease.until > reference.getTime()) return false;
      if (record.status === ExecutionStatus.PENDING) return new Date(record.createdAt) <= staleBefore;
      const last = record.attempts.at(-1);
      return Boolean(last?.status === 'running' && new Date(last.startedAt) <= staleBefore);
    }).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)).slice(0, limit);
    return stale.map((record) => {
      const execution = Execution.reconstitute(structuredClone(record));
      const token = randomUUID();
      this.#leases.set(record.id, { token, until: reference.getTime() + leaseMs });
      this.#leaseOwners.set(execution, token);
      return execution;
    });
  }
}
