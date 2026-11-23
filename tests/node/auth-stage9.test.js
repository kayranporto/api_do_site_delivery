import test from 'node:test';
import assert from 'node:assert/strict';
import { CreateApiClient } from '../../src/application/use-cases/CreateApiClient.js';
import { RevokeApiClient } from '../../src/application/use-cases/RevokeApiClient.js';
import { InMemoryApiClientRepository } from '../../src/infrastructure/repositories/InMemoryApiClientRepository.js';
import { PostgresApiClientRepository } from '../../src/infrastructure/repositories/PostgresApiClientRepository.js';
import { RandomApiKeyGenerator, hashApiKey } from '../../src/infrastructure/security/RandomApiKeyGenerator.js';

function fixedClock() {
  const date = new Date('2026-11-23T12:00:00.000Z');
  return { now: () => new Date(date) };
}
function idGenerator() { let value = 0; return { generate: () => 'client-' + (++value) }; }

test('cria credencial com hash persistido e segredo retornado apenas uma vez', async () => {
  const repository = new InMemoryApiClientRepository();
  const useCase = new CreateApiClient({
    apiClientRepository: repository,
    idGenerator: idGenerator(),
    clock: fixedClock(),
    apiKeyGenerator: new RandomApiKeyGenerator()
  });
  const result = await useCase.execute({
    name: 'CRM de testes',
    scopes: ['integrations:read', 'executions:read'],
    integrationIds: ['integration-a']
  });
  assert.match(result.credential, /^gik_[a-f0-9]{16}\.[A-Za-z0-9_-]{43}$/);
  assert.equal(result.client.name, 'CRM de testes');
  assert.equal(Object.hasOwn(result.client, 'keyHash'), false);
  const stored = await repository.findActiveByPrefix(result.client.keyPrefix);
  assert.equal(stored.keyHash, hashApiKey(result.credential));
  const [listed] = await repository.list();
  assert.equal(Object.hasOwn(listed, 'keyHash'), false);
  const audit = await repository.listAudit(result.client.id);
  assert.equal(audit[0].action, 'created');
});

test('credenciais aceitam escopos permitidos e rejeitam escopo desconhecido ou duplicado', async () => {
  const repository = new InMemoryApiClientRepository();
  const useCase = new CreateApiClient({
    apiClientRepository: repository,
    idGenerator: idGenerator(),
    clock: fixedClock(),
    apiKeyGenerator: new RandomApiKeyGenerator()
  });
  await assert.rejects(() => useCase.execute({ name: 'Cliente', scopes: ['admin:*'] }), /permissões inválidas/);
  await assert.rejects(() => useCase.execute({ name: 'Cliente', scopes: ['integrations:read', 'integrations:read'] }), /duplicatas/);
  const result = await useCase.execute({ name: 'Global API', scopes: ['integrations:read'], integrationIds: null });
  assert.equal(result.client.integrationIds, null);
});

test('revoga credencial e impede novas buscas pela chave', async () => {
  const repository = new InMemoryApiClientRepository();
  const clock = fixedClock();
  const created = await new CreateApiClient({
    apiClientRepository: repository, idGenerator: idGenerator(), clock,
    apiKeyGenerator: new RandomApiKeyGenerator()
  }).execute({ name: 'Revogar', scopes: ['executions:read'] });
  const revoked = await new RevokeApiClient({ apiClientRepository: repository, clock })
    .execute({ clientId: created.client.id });
  assert.ok(revoked.revokedAt);
  assert.equal(await repository.findActiveByPrefix(created.client.keyPrefix), null);
  assert.equal(await repository.revoke('missing', clock.now()), null);
  const audit = await repository.listAudit(created.client.id);
  assert.deepEqual(audit.map((item) => item.action), ['created', 'revoked']);
});

test('auditoria de autenticação atualiza último uso sem incluir segredo', async () => {
  const repository = new InMemoryApiClientRepository();
  const created = await new CreateApiClient({
    apiClientRepository: repository, idGenerator: idGenerator(), clock: fixedClock(),
    apiKeyGenerator: new RandomApiKeyGenerator()
  }).execute({ name: 'Audit', scopes: ['executions:read'] });
  await repository.recordAudit({
    clientId: created.client.id, action: 'authenticated', requestId: 'req-123',
    createdAt: new Date('2026-11-23T12:01:00.000Z')
  });
  const [entry] = await repository.listAudit(created.client.id);
  assert.equal(entry.action, 'authenticated');
  assert.equal(entry.requestId, 'req-123');
  const [client] = await repository.list();
  assert.equal(client.lastUsedAt.toISOString(), '2026-11-23T12:01:00.000Z');
  assert.equal(Object.hasOwn(client, 'keyHash'), false);
});

test('PostgresApiClientRepository usa parâmetros SQL e nunca devolve hash em listagem', async () => {
  const calls = [];
  const baseRow = {
    id: '3f48f5c2-9779-4f0c-8f5c-3e7c80d56c19',
    name: 'Postgres client',
    key_prefix: '0123456789abcdef',
    key_hash: 'a'.repeat(64),
    scopes: ['executions:read'],
    integration_ids: ['integration-1'],
    created_at: new Date('2026-11-23T12:00:00.000Z'),
    revoked_at: null,
    last_used_at: null
  };
  const pool = {
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.startsWith('INSERT INTO api_clients')) return { rows: [baseRow] };
      if (sql.startsWith('SELECT * FROM api_clients')) return { rows: [baseRow] };
      if (sql.startsWith('SELECT id, name, key_prefix')) return { rows: [baseRow] };
      if (sql.startsWith('INSERT INTO api_client_audit')) return { rows: [{
        id: 'audit-id', client_id: baseRow.id, action: values[1],
        request_id: values[2], created_at: values[3]
      }] };
      if (sql.startsWith('UPDATE api_clients')) return { rows: [baseRow] };
      throw new Error('SQL inesperado no teste.');
    }
  };
  const repository = new PostgresApiClientRepository({ pool });
  const created = await repository.create({
    id: baseRow.id, name: baseRow.name, keyPrefix: baseRow.key_prefix,
    keyHash: baseRow.key_hash, scopes: baseRow.scopes,
    integrationIds: baseRow.integration_ids, createdAt: baseRow.created_at
  });
  assert.equal(created.keyPrefix, '0123456789abcdef');
  assert.equal(Object.hasOwn(created, 'keyHash'), false);
  assert.ok(calls[0].sql.includes('VALUES ($1, $2, $3, $4, $5::text[], $6::text[], $7, $8, $9, $10)'));

  const found = await repository.findActiveByPrefix(created.keyPrefix);
  assert.equal(found.keyHash, baseRow.key_hash);
  const listed = await repository.list();
  assert.equal(Object.hasOwn(listed[0], 'keyHash'), false);
  await repository.recordAudit({
    clientId: created.id, action: 'authenticated', requestId: 'req-db',
    createdAt: new Date('2026-11-23T12:02:00.000Z')
  });
  assert.equal(calls.some((call) => call.sql.includes('SET last_used_at')), true);
});
