import { IntegrationRepository } from '../../domain/ports/IntegrationRepository.js';
import { Integration } from '../../domain/entities/Integration.js';

function jsonValue(value) {
  if (typeof value === 'string') return JSON.parse(value);
  return value;
}

function reconstitute(row) {
  return new Integration({
    id: row.id,
    name: row.name,
    providerKey: row.provider_key,
    configurationReference: row.configuration_reference,
    secretReference: row.secret_reference,
    status: row.status,
    timeoutMs: row.timeout_ms,
    retryPolicy: jsonValue(row.retry_policy),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

/** Adaptador PostgreSQL. Recebe um Pool compatível com node-postgres por injeção. */
export class PostgresIntegrationRepository extends IntegrationRepository {
  constructor({ pool }) {
    super();
    if (!pool || typeof pool.query !== 'function') throw new TypeError('pool PostgreSQL é obrigatório.');
    this.pool = pool;
  }

  async save(integration) {
    const record = integration.toJSON();
    const sql = [
      'INSERT INTO integrations (',
      'id, name, provider_key, configuration_reference, secret_reference,',
      'status, timeout_ms, retry_policy, created_at, updated_at',
      ') VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)',
      'ON CONFLICT (id) DO UPDATE SET',
      'name = EXCLUDED.name, provider_key = EXCLUDED.provider_key,',
      'configuration_reference = EXCLUDED.configuration_reference,',
      'secret_reference = EXCLUDED.secret_reference, status = EXCLUDED.status,',
      'timeout_ms = EXCLUDED.timeout_ms, retry_policy = EXCLUDED.retry_policy,',
      'updated_at = EXCLUDED.updated_at RETURNING *'
    ].join(' ');
    const result = await this.pool.query(sql, [
      record.id,
      record.name,
      record.providerKey,
      record.configurationReference,
      record.secretReference,
      record.status,
      record.timeoutMs,
      JSON.stringify(record.retryPolicy),
      record.createdAt,
      record.updatedAt
    ]);
    return reconstitute(result.rows[0]);
  }

  async findById(integrationId) {
    const result = await this.pool.query('SELECT * FROM integrations WHERE id = $1', [integrationId]);
    return result.rows[0] ? reconstitute(result.rows[0]) : null;
  }

  async findByProviderKey(providerKey) {
    const key = typeof providerKey === 'string' ? providerKey : providerKey.value;
    const result = await this.pool.query(
      'SELECT * FROM integrations WHERE provider_key = $1 ORDER BY created_at ASC',
      [key]
    );
    return result.rows.map(reconstitute);
  }

  async listActive() {
    const result = await this.pool.query(
      "SELECT * FROM integrations WHERE status = 'active' ORDER BY created_at ASC"
    );
    return result.rows.map(reconstitute);
  }
}
