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
    expiresAt: record.expiresAt ? new Date(record.expiresAt) : null,
    rateLimitMax: record.rateLimitMax,
    rateLimitWindowMs: record.rateLimitWindowMs,
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
      expiresAt: client.expiresAt ? new Date(client.expiresAt) : null,
      rateLimitMax: client.rateLimitMax ?? 120,
      rateLimitWindowMs: client.rateLimitWindowMs ?? 60_000,
      revokedAt: null,
      lastUsedAt: null
    };
    this.#clients.set(record.id, record);
    return safeClient(record);
  }

  async findActiveByPrefix(keyPrefix, now = new Date()) {
    const current = now instanceof Date ? now : new Date(now);
    const record = [...this.#clients.values()].find((item) => (
      item.keyPrefix === keyPrefix
      && !item.revokedAt
      && item.expiresAt instanceof Date && item.expiresAt > current
    ));
    return record ? { ...safeClient(record), keyHash: record.keyHash } : null;
  }

  async rotateCredential({ clientId, keyPrefix, keyHash, expiresAt, rotatedAt }) {
    const record = this.#clients.get(clientId);
    if (!record || record.revokedAt) return null;
    if ([...this.#clients.values()].some((item) => item.id !== clientId && item.keyPrefix === keyPrefix)) {
      throw new Error('Prefixo de credencial duplicado.');
    }
    record.keyPrefix = keyPrefix;
    record.keyHash = keyHash;
    record.expiresAt = new Date(expiresAt);
    record.rotatedAt = new Date(rotatedAt);
    return safeClient(record);
  }

  async updateLimits({ clientId, rateLimitMax, rateLimitWindowMs }) {
    const record = this.#clients.get(clientId);
    if (!record) return null;
    if (rateLimitMax !== undefined) record.rateLimitMax = rateLimitMax;
    if (rateLimitWindowMs !== undefined) record.rateLimitWindowMs = rateLimitWindowMs;
    return safeClient(record);
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
    if (!['created', 'authenticated', 'revoked', 'rotated', 'limits_updated'].includes(event.action)) {
      throw new TypeError('Ação de auditoria inválida.');
    }
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
