import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../../src/infrastructure/configuration/loadConfig.js';

test('loadConfig valida token, porta, CORS e configurações de persistência', () => {
  const config = loadConfig({
    API_ACCESS_TOKEN: 'this-is-a-random-test-token-that-is-long-enough',
    HOST: '127.0.0.1',
    PORT: '3100',
    CORS_ORIGINS: 'https://client.example.test, http://localhost:5173',
    PROVIDER_CONFIG_JSON: '{}'
  });
  assert.equal(config.port, 3100);
  assert.deepEqual(config.corsOrigins, ['https://client.example.test', 'http://localhost:5173']);
  assert.deepEqual(config.providerConfigurations, {});
  assert.equal(config.databaseUrl, null);
  assert.equal(config.databasePoolMax, 10);
  assert.equal(config.nodeEnv, 'development');
  assert.equal(config.workerIntervalMs, 5000);
  assert.equal(config.workerBatchSize, 20);
  assert.equal(config.workerStaleAfterMs, 300000);
  assert.equal(config.workerLeaseMs, 180000);

  assert.throws(() => loadConfig({ API_ACCESS_TOKEN: 'short' }), /pelo menos 32 caracteres/);
  assert.throws(() => loadConfig({ API_ACCESS_TOKEN: 'x'.repeat(40), PORT: '70000' }), /PORT/);
  assert.throws(() => loadConfig({ API_ACCESS_TOKEN: 'x'.repeat(40), CORS_ORIGINS: '*' }), /wildcard/);
  assert.throws(() => loadConfig({
    API_ACCESS_TOKEN: 'x'.repeat(40),
    DATABASE_URL: 'https://example.test/database'
  }), /protocolo postgres/);
  assert.throws(() => loadConfig({
    API_ACCESS_TOKEN: 'x'.repeat(40),
    DATABASE_POOL_MAX: '0'
  }), /DATABASE_POOL_MAX/);
  assert.throws(() => loadConfig({
    API_ACCESS_TOKEN: 'x'.repeat(40),
    NODE_ENV: 'production'
  }), /DATABASE_URL é obrigatório/);

  assert.throws(() => loadConfig({ API_ACCESS_TOKEN: 'x'.repeat(40), WORKER_BATCH_SIZE: '101' }), /WORKER_BATCH_SIZE/);

  const postgres = loadConfig({
    API_ACCESS_TOKEN: 'x'.repeat(40),
    DATABASE_URL: 'postgresql://service:secret@localhost:5432/integrations',
    DATABASE_POOL_MAX: '15',
    NODE_ENV: 'production'
  });
  assert.equal(postgres.databasePoolMax, 15);
  assert.equal(postgres.nodeEnv, 'production');
});
