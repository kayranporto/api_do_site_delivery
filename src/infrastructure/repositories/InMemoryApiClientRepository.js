import { randomUUID } from 'node:crypto';
import { ApiClientRepository } from '../../application/ports/ApiClientRepository.js';

function safeClient(record) {
  if (!record) return null;
  return {
    id: record.id,
    name: record.name,
    keyPrefix: record.keyPrefix,
    scopes: [...record.scopes],
    integrationIds: record.integrationIds === null ? null : [...record.integrationIds],
    createdAt: new Date(record.createdAt),
    revokedAt: record.revokedAt ? new Date(record.revokedAt) : null,
    lastUsedAt: record.lastUsedAt ? new Date(record.lastUsedAt) : null
  };
}

export class InMemoryApiClientRepository extends ApiClientRepository {
  #clients = new Map();
  #audit = [];

  async create(client) {
    if (this.#clients.has(client.id)) throw new Error('API client já existe.');
    if ([...this.#clients.values()].some((item) => item.keyPrefix === client.keyPrefix)) {
      throw new Error('Prefixo de credencial duplicado.');
    }
    const record = {
      ...client,
      scopes: [...client.scopes],
      integrationIds: client.integrationIds === null ? null : [...client.integrationIds],
      createdAt: new Date(client.createdAt),
      revokedAt: null,
      lastUsedAt: null
    };
    this.#clients.set(record.id, record);
    return safeClient(record);
  }

  async findActiveByPrefix(keyPrefix) {
    const record = [...this.#clients.values()].find((item) => item.keyPrefix === keyPrefix && !item.revokedAt);
    return record ? {
      ...safeClient(record),
      keyHash: record.keyHash
    } : null;
  }

  async revoke(clientId, revokedAt) {
    const record = this.#clients.get(clientId);
    if (!record) return null;
    if (!record.revokedAt) record.revokedAt = new Date(revokedAt);
    return safeClient(record);
  }

  async list() {
    return [...this.#clients.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(safeClient);
  }

  async recordAudit(event) {
    if (!this.#clients.has(event.clientId)) throw new Error('API client não encontrado para auditoria.');
    const record = {
      id: randomUUID(),
      clientId: event.clientId,
      action: event.action,
      requestId: event.requestId ?? null,
      createdAt: new Date(event.createdAt ?? Date.now())
    };
    this.#audit.push(record);
    if (event.action === 'authenticated') {
      this.#clients.get(event.clientId).lastUsedAt = new Date(record.createdAt);
    }
    return { ...record, createdAt: new Date(record.createdAt) };
  }

  async listAudit(clientId, limit = 100) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new RangeError('limit deve ficar entre 1 e 500.');
    return this.#audit
      .filter((event) => event.clientId === clientId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
      .map((event) => ({ ...event, createdAt: new Date(event.createdAt) }));
  }
}
