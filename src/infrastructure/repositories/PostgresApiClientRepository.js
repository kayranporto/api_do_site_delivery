import { ApiClientRepository } from '../../application/ports/ApiClientRepository.js';

function safeClient(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    keyPrefix: row.key_prefix.trim(),
    scopes: [...row.scopes],
    integrationIds: row.integration_ids === null ? null : [...row.integration_ids],
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
    lastUsedAt: row.last_used_at
  };
}

function auditResource(row) {
  return {
    id: row.id,
    clientId: row.client_id,
    action: row.action,
    requestId: row.request_id,
    createdAt: row.created_at
  };
}

export class PostgresApiClientRepository extends ApiClientRepository {
  constructor({ pool }) {
    super();
    if (!pool || typeof pool.query !== 'function') throw new TypeError('pool PostgreSQL é obrigatório.');
    this.pool = pool;
  }

  async create(client) {
    const result = await this.pool.query(
      'INSERT INTO api_clients (id, name, key_prefix, key_hash, scopes, integration_ids, created_at) ' +
      'VALUES ($1, $2, $3, $4, $5::text[], $6::text[], $7) RETURNING *',
      [client.id, client.name, client.keyPrefix, client.keyHash, client.scopes,
        client.integrationIds, client.createdAt]
    );
    return safeClient(result.rows[0]);
  }

  async findActiveByPrefix(keyPrefix) {
    const result = await this.pool.query(
      'SELECT * FROM api_clients WHERE key_prefix = $1 AND revoked_at IS NULL LIMIT 1',
      [keyPrefix]
    );
    const row = result.rows[0];
    return row ? { ...safeClient(row), keyHash: row.key_hash } : null;
  }

  async revoke(clientId, revokedAt) {
    const result = await this.pool.query(
      'UPDATE api_clients SET revoked_at = COALESCE(revoked_at, $2) WHERE id = $1 RETURNING *',
      [clientId, revokedAt]
    );
    return safeClient(result.rows[0]);
  }

  async list() {
    const result = await this.pool.query(
      'SELECT id, name, key_prefix, scopes, integration_ids, created_at, revoked_at, last_used_at ' +
      'FROM api_clients ORDER BY created_at DESC'
    );
    return result.rows.map(safeClient);
  }

  async recordAudit(event) {
    const result = await this.pool.query(
      'INSERT INTO api_client_audit (client_id, action, request_id, created_at) ' +
      'VALUES ($1, $2, $3, $4) RETURNING *',
      [event.clientId, event.action, event.requestId ?? null, event.createdAt ?? new Date()]
    );
    if (event.action === 'authenticated') {
      await this.pool.query(
        'UPDATE api_clients SET last_used_at = $2 WHERE id = $1',
        [event.clientId, event.createdAt ?? new Date()]
      );
    }
    return auditResource(result.rows[0]);
  }

  async listAudit(clientId, limit = 100) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new RangeError('limit deve ficar entre 1 e 500.');
    const result = await this.pool.query(
      'SELECT id, client_id, action, request_id, created_at FROM api_client_audit ' +
      'WHERE client_id = $1 ORDER BY created_at DESC LIMIT $2',
      [clientId, limit]
    );
    return result.rows.map(auditResource);
  }
}
