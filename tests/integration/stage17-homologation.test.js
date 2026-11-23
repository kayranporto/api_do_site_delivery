import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { Execution } from '../../src/domain/entities/Execution.js';
import { ProviderExecutionError } from '../../src/application/errors/ProviderExecutionError.js';
import { createContainer } from '../../src/bootstrap/createContainer.js';
import { createPostgresPersistence } from '../../src/infrastructure/postgres/createPostgresPersistence.js';
import { migratePostgresDatabase } from '../../src/infrastructure/postgres/runMigrations.js';
import { UpstashRedisRateLimitStore } from '../../src/infrastructure/rate-limits/UpstashRedisRateLimitStore.js';
import { createHttpApp } from '../../src/infrastructure/http/createHttpApp.js';
import { createWorker } from '../../src/worker/createWorker.js';
import { startRedisRestBridge } from './upstash-rest-bridge.js';

const MASTER_TOKEN = 'stage17-homologation-master-token-keep-local-only';
const REDIS_BRIDGE_TOKEN = 'stage17-local-redis-rest-bridge-token';

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(name + ' é obrigatório para a homologação isolada.');
  return value;
}

function assertIsolatedDatabase(connectionString) {
  let url;
  try { url = new URL(connectionString); } catch { throw new Error('DATABASE_URL inválida para homologação.'); }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1']);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !loopbackHosts.has(url.hostname)
    || database !== 'stage17_homologation'
    || process.env.STAGING_ALLOW_DB_RESET !== 'true') {
    throw new Error(
      'Proteção contra produção: use um PostgreSQL local, database stage17_homologation e STAGING_ALLOW_DB_RESET=true.'
    );
  }
}

function master(req) {
  return req.set('Authorization', 'Bearer ' + MASTER_TOKEN);
}

test('Etapa 17: homologa PostgreSQL, Redis REST, credenciais, quotas, API e worker', {
  timeout: 60_000
}, async () => {
  const connectionString = requiredEnvironment('DATABASE_URL');
  assertIsolatedDatabase(connectionString);
  const redisHost = process.env.REDIS_HOST ?? '127.0.0.1';
  const redisPort = Number(process.env.REDIS_PORT ?? 6379);
  assert.ok(new Set(['127.0.0.1', 'localhost', '::1']).has(redisHost),
    'REDIS_HOST deve apontar para o Redis local do ambiente de teste.');

  let persistence;
  let bridge;
  try {
    await migratePostgresDatabase({ connectionString, max: 1 });
    persistence = await createPostgresPersistence({ connectionString, max: 5 });
    await persistence.pool.query(
      'TRUNCATE TABLE api_client_audit, api_clients, execution_events, executions, integrations CASCADE'
    );

    bridge = await startRedisRestBridge({
      redisHost,
      redisPort,
      token: REDIS_BRIDGE_TOKEN
    });
    const namespace = 'stage17-homologation';
    const redisOptions = {
      url: bridge.url,
      token: REDIS_BRIDGE_TOKEN,
      namespace
    };
    const redisFirst = new UpstashRedisRateLimitStore(redisOptions);
    const redisSecond = new UpstashRedisRateLimitStore(redisOptions);
    assert.equal(await redisFirst.ping(), true);

    // Dois adapters separados precisam compartilhar os mesmos contadores no Redis real.
    const sharedNow = Date.now();
    const firstCount = await redisFirst.consume({
      key: 'integration:shared-counter',
      windowMs: 60_000,
      now: sharedNow
    });
    const secondCount = await redisSecond.consume({
      key: 'integration:shared-counter',
      windowMs: 60_000,
      now: sharedNow + 1
    });
    assert.equal(firstCount.count, 1);
    assert.equal(secondCount.count, 2);

    const container = createContainer({
      repositories: persistence.repositories,
      executionLeaseMs: 60_000,
      staleAfterMs: 10_000
    });
    let providerAttempts = 0;
    container.adapters.providerRegistry.register('stage17-provider', {
      async execute() {
        providerAttempts += 1;
        if (providerAttempts === 1) {
          throw new ProviderExecutionError({
            code: 'STAGING_TRANSIENT_FAILURE',
            retryable: true
          });
        }
        return { accepted: true, attempt: providerAttempts };
      }
    });

    const app = createHttpApp({
      useCases: container.useCases,
      apiAccessToken: MASTER_TOKEN,
      apiClientRepository: container.repositories.apiClientRepository,
      executionRepository: container.repositories.executionRepository,
      rateLimitStore: redisFirst,
      rateLimitWindowMs: 60_000,
      rateLimitMax: 10_000,
      readinessChecks: {
        postgres: async () => {
          await persistence.pool.query('SELECT 1');
          return true;
        }
      }
    });

    const ready = await request(app).get('/readyz').expect(200);
    assert.equal(ready.body.status, 'ready');
    assert.equal(ready.body.checks.postgres, 'ok');
    assert.equal(ready.body.checks.rateLimitStore, 'ok');

    const createdIntegration = await master(request(app).post('/api/v1/integrations'))
      .send({
        name: 'Integração de homologação',
        providerKey: 'stage17-provider',
        configurationReference: 'config:stage17:provider',
        timeoutMs: 5_000,
        retryPolicy: { maxAttempts: 2, initialDelayMs: 0, maxDelayMs: 0, backoffMultiplier: 1 }
      })
      .expect(201);
    const integrationId = createdIntegration.body.data.id;
    await master(request(app).post('/api/v1/integrations/' + integrationId + '/activate')).expect(200);

    const createdClient = await master(request(app).post('/api/v1/clients'))
      .send({
        name: 'Cliente de homologação',
        scopes: ['integrations:read'],
        integrationIds: [integrationId],
        expiresInDays: 2,
        rateLimitMax: 2,
        rateLimitWindowMs: 60_000
      })
      .expect(201);
    const clientId = createdClient.body.data.id;
    const clientToken = createdClient.body.credential;
    assert.match(clientToken, /^gik_[a-f0-9]{16}\.[A-Za-z0-9_-]{43}$/);
    assert.equal(createdClient.body.meta.credentialShownOnce, true);

    const clientRequest = (method, path) => request(app)[method](path)
      .set('Authorization', 'Bearer ' + clientToken);
    await clientRequest('get', '/api/v1/integrations').expect(200);
    await clientRequest('get', '/api/v1/integrations/' + integrationId).expect(200);
    await clientRequest('get', '/api/v1/integrations').expect(429);

    const usage = await master(request(app).get('/api/v1/clients/' + clientId + '/usage?days=1')).expect(200);
    assert.equal(usage.body.data.totalRequests, 3);
    const audit = await master(request(app).get('/api/v1/clients/' + clientId + '/audit?limit=100')).expect(200);
    assert.equal(audit.body.data.filter((event) => event.action === 'authenticated').length, 2);

    await master(request(app).post('/api/v1/clients/' + clientId + '/revoke')).expect(200);
    await clientRequest('get', '/api/v1/integrations').expect(401);

    // A primeira tentativa falha transitoriamente; o worker real do projeto consome o retry no PostgreSQL.
    const operation = await master(request(app).post('/api/v1/integrations/' + integrationId + '/operations'))
      .send({
        operationName: 'records.create',
        payload: { source: 'stage17-homologation' },
        idempotencyKey: 'stage17-retry-0001'
      })
      .expect(201);
    const executionId = operation.body.data.id;
    assert.equal(operation.body.data.status, 'retry_scheduled');
    assert.equal(operation.body.data.attemptCount, 1);

    const worker = createWorker({
      useCases: container.useCases,
      staleAfterMs: 10_000,
      logger: { info() {}, error() {} }
    });
    const retryCycle = await worker.runOnce();
    assert.equal(retryCycle.summary.retried, 1);
    assert.equal(providerAttempts, 2);
    const completed = await master(request(app).get('/api/v1/executions/' + executionId)).expect(200);
    assert.equal(completed.body.data.status, 'succeeded');
    assert.equal(completed.body.data.attemptCount, 2);

    // Uma execução pendente antiga deve ser recuperada e marcada interrupted sem retry cego.
    const staleExecution = new Execution({
      id: 'stage17-stale-pending-execution',
      integrationId,
      operationName: 'records.create',
      input: { source: 'stale-recovery-test' },
      createdAt: new Date(Date.now() - 60_000)
    });
    await container.repositories.executionRepository.save(staleExecution);
    const recoveryCycle = await worker.runOnce();
    assert.equal(recoveryCycle.summary.recovered, 1);
    const recovered = await master(request(app).get('/api/v1/executions/' + staleExecution.id)).expect(200);
    assert.equal(recovered.body.data.status, 'interrupted');

    const eventRows = await persistence.pool.query(
      'SELECT event_type FROM execution_events WHERE execution_id = $1 ORDER BY created_at',
      [staleExecution.id]
    );
    assert.ok(eventRows.rows.some((row) => row.event_type === 'execution.interrupted'));
    assert.equal((await persistence.pool.query('SELECT version FROM schema_migrations')).rows.length, 5);
  } finally {
    await bridge?.close();
    await persistence?.close();
  }
});
