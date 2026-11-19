import assert from 'node:assert/strict';
import {
  Execution,
  ExecutionStatus,
  Integration,
  RetryPolicy
} from '../src/domain/index.js';

const integration = new Integration({
  id: 'integration-smoke',
  name: 'Serviço externo de exemplo',
  providerKey: 'example-provider',
  configurationReference: 'config:example:default',
  secretReference: 'vault:example:credential',
  createdAt: new Date('2026-01-01T00:00:00.000Z')
});

assert.equal(integration.status, 'inactive');
integration.activate(new Date('2026-01-01T00:01:00.000Z'));
integration.assertCanExecute();

const execution = new Execution({
  id: 'execution-smoke',
  integrationId: integration.id,
  operationName: 'records.create',
  input: { record: { title: 'Example' } },
  idempotencyKey: 'smoke-12345678',
  retryPolicy: new RetryPolicy({ maxAttempts: 2, initialDelayMs: 500, maxDelayMs: 500 }),
  createdAt: new Date('2026-01-01T00:02:00.000Z')
});

execution.startAttempt(new Date('2026-01-01T00:02:01.000Z'));
execution.fail({
  failedAt: new Date('2026-01-01T00:02:02.000Z'),
  errorCode: 'TEMPORARY_FAILURE',
  retryable: true
});
assert.equal(execution.status, ExecutionStatus.RETRY_SCHEDULED);
assert.equal(execution.nextAttemptAt.toISOString(), '2026-01-01T00:02:02.500Z');
execution.startAttempt(new Date('2026-01-01T00:02:02.500Z'));
execution.succeed({ completedAt: new Date('2026-01-01T00:02:03.000Z') });
assert.equal(execution.status, ExecutionStatus.SUCCEEDED);
assert.equal(execution.attemptCount, 2);

console.log('Domain smoke test: OK');
