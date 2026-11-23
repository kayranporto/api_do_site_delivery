import test from 'node:test';
import assert from 'node:assert/strict';
import { CreateApiClient } from '../../src/application/use-cases/CreateApiClient.js';
import { RotateApiClient } from '../../src/application/use-cases/RotateApiClient.js';
import { UpdateApiClientLimits } from '../../src/application/use-cases/UpdateApiClientLimits.js';
import { InMemoryApiClientRepository } from '../../src/infrastructure/repositories/InMemoryApiClientRepository.js';
import { PostgresApiClientRepository } from '../../src/infrastructure/repositories/PostgresApiClientRepository.js';
import { RandomApiKeyGenerator, hashApiKey } from '../../src/infrastructure/security/RandomApiKeyGenerator.js';
import { createRateLimiter } from '../../src/infrastructure/http/middleware/rateLimit.js';

function makeClock(initial = '2026-11-23T12:00:00.000Z') {
  let current = new Date(initial);
  return {
    now: () => new Date(current),
    advance(ms) { current = new Date(current.getTime() + ms); }
  };
}
function idGenerator() { let value = 0; return { generate: () => 'client-stage10-' + (++value) }; }
function makeCreator(repository, clock) {
  return new CreateApiClient({
    apiClientRepository: repository,
    idGenerator: idGenerator(),
    clock,
    apiKeyGenerator: new RandomApiKeyGenerator()
  });
}

test('CreateApiClient aplica expiração e quotas padrão ou customizadas', async () => {
  const repository = new InMemoryApiClientRepository();
  const clock = makeClock();
  const create = makeCreator(repository, clock);
  const defaultClient = await create.execute({
    name: 'Default client', scopes: ['integrations:read']
  });
  assert.equal(defaultClient.client.rateLimitMax, 120);
  assert.equal(defaultClient.client.rateLimitWindowMs, 60_000);
  assert.equal(defaultClient.client.expiresAt.toISOString(), '2027-02-21T12:00:00.000Z');

  const custom = await create.execute({
    name: 'Custom client',
    scopes: ['integrations:read'],
    expiresInDays: 7,
    rateLimitMax: 5,
    rateLimitWindowMs: 10_000
  });
  assert.equal(custom.client.expiresAt.toISOString(), '2026-11-30T12:00:00.000Z');
  assert.equal(custom.client.rateLimitMax, 5);
  assert.equal(custom.client.rateLimitWindowMs, 10_000);
  await assert.rejects(() => makeCreator(repository, clock).execute({
    name: 'Bad expiry', scopes: ['integrations:read'], expiresInDays: 3651
  }), /expiresInDays/);
  await assert.rejects(() => makeCreator(repository, clock).execute({
    name: 'Bad quota', scopes: ['integrations:read'], rateLimitMax: 0
  }), /rateLimitMax/);
});

test('credencial expirada não pode ser autenticada pelo repositório em memória', async () => {
  const repository = new InMemoryApiClientRepository();
  const key = new RandomApiKeyGenerator().generate();
  const now = new Date('2026-11-23T12:00:00.000Z');
  await repository.create({
    id: 'expired-client',
    name: 'Expired client',
    keyPrefix: key.keyPrefix,
    keyHash: key.keyHash,
    scopes: ['integrations:read'],
    integrationIds: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: new Date('2026-11-22T00:00:00.000Z'),
    rateLimitMax: 120,
    rateLimitWindowMs: 60_000
  });
  assert.equal(await repository.findActiveByPrefix(key.keyPrefix, now), null);
});

test('RotateApiClient troca a chave, renova validade e registra auditoria', async () => {
  const repository = new InMemoryApiClientRepository();
  const clock = makeClock();
  const created = await makeCreator(repository, clock).execute({
    name: 'Rotating client',
    scopes: ['integrations:read'],
    expiresInDays: 1
  });
  const rotated = await new RotateApiClient({
    apiClientRepository: repository,
    clock,
    apiKeyGenerator: new RandomApiKeyGenerator()
  }).execute({ clientId: created.client.id, expiresInDays: 30 });

  assert.notEqual(rotated.credential, created.credential);
  assert.notEqual(rotated.client.keyPrefix, created.client.keyPrefix);
  assert.equal(rotated.client.expiresAt.toISOString(), '2026-12-23T12:00:00.000Z');
  const oldLookup = await repository.findActiveByPrefix(created.client.keyPrefix);
  assert.equal(oldLookup, null);
  const newLookup = await repository.findActiveByPrefix(rotated.client.keyPrefix);
  assert.equal(newLookup.keyHash, hashApiKey(rotated.credential));
  const audit = await repository.listAudit(created.client.id);
  assert.deepEqual(audit.map((item) => item.action), ['created', 'rotated']);
  assert.equal(await new RotateApiClient({
    apiClientRepository: repository,
    clock,
    apiKeyGenerator: new RandomApiKeyGenerator()
  }).execute({ clientId: 'missing' }), null);
});

test('rate limiter suporta janelas e limites independentes por cliente', () => {
  const clock = makeClock();
  const limiter = createRateLimiter({
    clock: () => clock.now().getTime(),
    keyResolver: (req) => 'client:' + req.auth.clientId,
    maxRequests: (req) => req.auth.rateLimitMax,
    windowMs: (req) => req.auth.rateLimitWindowMs
  });
  const response = () => ({
    headers: {}, statusCode: 200,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; }
  });
  const send = (clientId, max) => {
    const res = response();
    let nextCalls = 0;
    limiter({ auth: { clientId, rateLimitMax: max, rateLimitWindowMs: 10_000 } }, res, () => { nextCalls += 1; });
    return { res, nextCalls };
  };
  assert.equal(send('A', 2).res.statusCode, 200);
  assert.equal(send('A', 2).res.statusCode, 200);
  assert.equal(send('A', 2).res.statusCode, 429);
  assert.equal(send('B', 1).res.statusCode, 200);
  assert.equal(send('B', 1).res.statusCode, 429);
  clock.advance(10_001);
  assert.equal(send('A', 2).res.statusCode, 200);
});

test('UpdateApiClientLimits altera quota, preserva valores omitidos e audita a mudança', async () => {
  const repository = new InMemoryApiClientRepository();
  const clock = makeClock();
  const created = await makeCreator(repository, clock).execute({
    name: 'Limit update client',
    scopes: ['integrations:read'],
    rateLimitMax: 30,
    rateLimitWindowMs: 20_000
  });
  const update = new UpdateApiClientLimits({ apiClientRepository: repository, clock });
  const changed = await update.execute({
    clientId: created.client.id,
    rateLimitMax: 8
  });
  assert.equal(changed.rateLimitMax, 8);
  assert.equal(changed.rateLimitWindowMs, 20_000);
  const changedWindow = await update.execute({
    clientId: created.client.id,
    rateLimitWindowMs: 5_000
  });
  assert.equal(changedWindow.rateLimitMax, 8);
  assert.equal(changedWindow.rateLimitWindowMs, 5_000);
  await assert.rejects(() => update.execute({ clientId: created.client.id }), /Informe rateLimitMax/);
  const audit = await repository.listAudit(created.client.id);
  assert.equal(audit.filter((item) => item.action === 'limits_updated').length, 2);
  assert.equal(await update.execute({ clientId: 'missing', rateLimitMax: 4 }), null);
});

test('PostgresApiClientRepository filtra expiração e atualiza hash ao rotacionar', async () => {
  const calls = [];
  const baseRow = {
    id: 'client-pg-stage10',
    name: 'Postgres lifecycle client',
    key_prefix: '0123456789abcdef',
    key_hash: 'a'.repeat(64),
    scopes: ['integrations:read'],
    integration_ids: null,
    created_at: new Date('2026-11-23T12:00:00.000Z'),
    expires_at: new Date('2027-02-21T12:00:00.000Z'),
    rate_limit_max: 25,
    rate_limit_window_ms: 30_000,
    revoked_at: null,
    last_used_at: null
  };
  const pool = {
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.startsWith('SELECT * FROM api_clients')) return { rows: [baseRow] };
      if (sql.startsWith('UPDATE api_clients SET key_prefix')) {
        return { rows: [{ ...baseRow, key_prefix: values[1], key_hash: values[2], expires_at: values[3] }] };
      }
      if (sql.startsWith('UPDATE api_clients SET rate_limit_max')) {
        return { rows: [{ ...baseRow, rate_limit_max: values[1] ?? baseRow.rate_limit_max, rate_limit_window_ms: values[2] ?? baseRow.rate_limit_window_ms }] };
      }
      throw new Error('SQL inesperado no teste.');
    }
  };
  const repository = new PostgresApiClientRepository({ pool });
  const found = await repository.findActiveByPrefix('0123456789abcdef');
  assert.equal(found.rateLimitMax, 25);
  assert.equal(found.expiresAt.toISOString(), '2027-02-21T12:00:00.000Z');
  assert.match(calls[0].sql, /expires_at > NOW\(\)/);

  const rotated = await repository.rotateCredential({
    clientId: baseRow.id,
    keyPrefix: 'fedcba9876543210',
    keyHash: 'b'.repeat(64),
    expiresAt: new Date('2027-03-23T12:00:00.000Z')
  });
  assert.equal(rotated.keyPrefix, 'fedcba9876543210');
  assert.equal(rotated.expiresAt.toISOString(), '2027-03-23T12:00:00.000Z');
  assert.match(calls[1].sql, /WHERE id = \$1 AND revoked_at IS NULL/);

  const updated = await repository.updateLimits({ clientId: baseRow.id, rateLimitMax: 12 });
  assert.equal(updated.rateLimitMax, 12);
  assert.equal(updated.rateLimitWindowMs, 30_000);
  assert.match(calls[2].sql, /rate_limit_window_ms = COALESCE/);
});
