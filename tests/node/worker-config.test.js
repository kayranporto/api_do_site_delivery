import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWorkerConfig } from '../../src/infrastructure/configuration/loadWorkerConfig.js';

test('loadWorkerConfig exige PostgreSQL e valida os parâmetros operacionais', () => {
  assert.throws(() => loadWorkerConfig({}), /DATABASE_URL é obrigatório/);
  const config = loadWorkerConfig({
    DATABASE_URL: 'postgresql://worker:secret@localhost:5432/integrations',
    DATABASE_POOL_MAX: '5',
    WORKER_INTERVAL_MS: '3000',
    WORKER_BATCH_SIZE: '10',
    WORKER_STALE_BATCH_SIZE: '15',
    WORKER_STALE_AFTER_MS: '600000',
    WORKER_LEASE_MS: '120000'
  });
  assert.equal(config.databasePoolMax, 5);
  assert.equal(config.intervalMs, 3000);
  assert.equal(config.batchSize, 10);
  assert.equal(config.staleBatchSize, 15);
  assert.equal(config.staleAfterMs, 600000);
  assert.equal(config.leaseMs, 120000);
  assert.throws(() => loadWorkerConfig({
    DATABASE_URL: 'postgres://worker:secret@localhost/db',
    WORKER_INTERVAL_MS: '10'
  }), /WORKER_INTERVAL_MS/);
});
