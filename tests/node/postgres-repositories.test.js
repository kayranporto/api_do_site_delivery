import test from 'node:test';
import assert from 'node:assert/strict';
import { Integration } from '../../src/domain/entities/Integration.js';
import { Execution } from '../../src/domain/entities/Execution.js';
import { InMemoryExecutionRepository } from '../../src/infrastructure/repositories/InMemoryExecutionRepository.js';
import { PostgresExecutionRepository } from '../../src/infrastructure/repositories/PostgresExecutionRepository.js';
import { PostgresIntegrationRepository } from '../../src/infrastructure/repositories/PostgresIntegrationRepository.js';

function makeExecution(overrides = {}) {
  return new Execution({
    id: 'execution-pg-test',
    integrationId: 'integration-pg-test',
    operationName: 'records.create',
    input: { title: 'Example' },
    idempotencyKey: 'request-postgres-1234',
    createdAt: new Date('2026-05-01T10:00:00.000Z'),
    ...overrides
  });
}

function executionRow(execution) {
  const record = execution.toJSON();
  return {
    id: record.id,
    integration_id: record.integrationId,
    operation_name: record.operationName,
    input: record.input,
    idempotency_key: record.idempotencyKey,
    retry_policy: record.retryPolicy,
    status: record.status,
    attempts: record.attempts,
    next_attempt_at: record.nextAttemptAt,
    completed_at: record.completedAt,
    created_at: new Date(record.createdAt)
  };
}

test('InMemoryExecutionRepository reserva uma chave idempotente apenas uma vez', async () => {
  const repository = new InMemoryExecutionRepository();
  const first = makeExecution();
  const second = makeExecution({ id: 'execution-pg-test-duplicate' });

  const results = await Promise.all([
    repository.createIfAbsent(first),
    repository.createIfAbsent(second)
  ]);

  assert.equal(results.filter((item) => item.created).length, 1);
  assert.equal(results.filter((item) => !item.created).length, 1);
  assert.equal(results[0].execution.id, results[1].execution.id);
});

test('InMemoryExecutionRepository reivindica retries uma vez até o lease expirar ou ser liberado', async () => {
  const repository = new InMemoryExecutionRepository();
  const execution = makeExecution({ idempotencyKey: null });
  execution.startAttempt(new Date('2026-05-01T10:00:01.000Z'));
  execution.fail({
    failedAt: new Date('2026-05-01T10:00:02.000Z'),
    errorCode: 'TEMPORARY_FAILURE',
    retryable: true
  });
  await repository.save(execution);

  const now = new Date('2026-05-01T10:00:03.000Z');
  assert.equal((await repository.claimDueForRetry(now, 10, 1_000)).length, 1);
  assert.equal((await repository.claimDueForRetry(now, 10, 1_000)).length, 0);
  await repository.save(await repository.findById(execution.id));
  assert.equal((await repository.claimDueForRetry(now, 10, 1_000)).length, 1);
});

test('PostgresExecutionRepository resolve conflito idempotente por leitura após inserção concorrente', async () => {
  const execution = makeExecution();
  const existing = makeExecution({ id: 'execution-existing' });
  const queries = [];
  const pool = {
    async query(sql, values) {
      queries.push({ sql, values });
      if (sql.includes('ON CONFLICT (integration_id, idempotency_key)')) return { rows: [] };
      if (sql.includes('SELECT * FROM executions WHERE integration_id = $1')) {
        return { rows: [executionRow(existing)] };
      }
      throw new Error('Consulta inesperada no teste.');
    }
  };

  const repository = new PostgresExecutionRepository({ pool });
  const result = await repository.createIfAbsent(execution);

  assert.equal(result.created, false);
  assert.equal(result.execution.id, existing.id);
  assert.match(queries[0].sql, /ON CONFLICT \(integration_id, idempotency_key\)/);
  assert.equal(queries[0].values[4], 'request-postgres-1234');
});

test('PostgresExecutionRepository usa SKIP LOCKED e lease para reivindicar retries', async () => {
  let captured;
  const repository = new PostgresExecutionRepository({
    pool: {
      async query(sql, values) {
        captured = { sql, values };
        return { rows: [] };
      }
    }
  });

  const now = new Date('2026-05-01T10:00:00.000Z');
  assert.deepEqual(await repository.claimDueForRetry(now, 5, 90_000), []);
  assert.match(captured.sql, /FOR UPDATE SKIP LOCKED/);
  assert.equal(captured.values[1], now);
  assert.equal(captured.values[2], 5);
  assert.equal(captured.values[4], 90_000);
});

test('PostgresIntegrationRepository persiste e reconstitui o agregado', async () => {
  const integration = new Integration({
    id: 'integration-pg-test',
    name: 'Postgres integration',
    providerKey: 'test-provider',
    configurationReference: 'config:test:default',
    secretReference: 'env:TEST_PROVIDER_TOKEN',
    status: 'active',
    createdAt: new Date('2026-05-01T10:00:00.000Z')
  });
  let captured;
  const pool = {
    async query(sql, values) {
      captured = { sql, values };
      return {
        rows: [{
          id: 'integration-pg-test',
          name: 'Postgres integration',
          provider_key: 'test-provider',
          configuration_reference: 'config:test:default',
          secret_reference: 'env:TEST_PROVIDER_TOKEN',
          status: 'active',
          timeout_ms: 10_000,
          retry_policy: { maxAttempts: 3, initialDelayMs: 1_000, maxDelayMs: 30_000, backoffMultiplier: 2 },
          created_at: new Date('2026-05-01T10:00:00.000Z'),
          updated_at: new Date('2026-05-01T10:00:00.000Z')
        }]
      };
    }
  };

  const repository = new PostgresIntegrationRepository({ pool });
  const saved = await repository.save(integration);
  assert.equal(saved.id, integration.id);
  assert.equal(saved.providerKey.value, 'test-provider');
  assert.match(captured.sql, /ON CONFLICT \(id\) DO UPDATE/);
});


test('PostgresExecutionRepository reivindica execuções stale com SKIP LOCKED e grava usando fencing token', async () => {
  const execution = makeExecution({ id: 'execution-stale-pg', idempotencyKey: null });
  let call = 0;
  const captured = [];
  const pool = {
    async query(sql, values) {
      captured.push({ sql, values });
      call += 1;
      if (call === 1) return { rows: [{ ...executionRow(execution), lease_token: 'lease-token-001' }] };
      return { rows: [executionRow(execution)] };
    }
  };
  const repository = new PostgresExecutionRepository({ pool });
  const cutoff = new Date('2026-05-01T10:05:00.000Z');
  const now = new Date('2026-05-01T10:06:00.000Z');
  const claimed = await repository.claimStaleExecutions(cutoff, now, 10, 60_000);

  assert.equal(claimed.length, 1);
  assert.match(captured[0].sql, /FOR UPDATE SKIP LOCKED/);
  assert.equal(captured[0].values[0], cutoff);
  assert.equal(captured[0].values[1], 10);
  assert.equal(captured[0].values[3], 60_000);

  claimed[0].interrupt(now);
  await repository.save(claimed[0]);
  assert.match(captured[1].sql, /WHERE id=\$1 AND lease_token=\$13/);
  assert.equal(captured[1].values[12], 'lease-token-001');
});

test('PostgresExecutionRepository recusa updates sem fencing enquanto existe lease', async () => {
  let captured;
  const repository = new PostgresExecutionRepository({
    pool: {
      async query(sql, values) {
        captured = { sql, values };
        return { rows: [] };
      }
    }
  });
  await assert.rejects(() => repository.save(makeExecution()), (error) => {
    assert.equal(error.code, 'EXECUTION_LEASE_ACTIVE');
    return true;
  });
  assert.match(captured.sql, /WHERE executions\.lease_token IS NULL/);
});
