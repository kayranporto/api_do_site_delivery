import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Execution,
  ExecutionStatus,
  Integration,
  RetryPolicy,
  ProviderKey,
  ValidationError,
  IntegrationInactiveError,
  BusinessRuleError
} from '../../src/domain/index.js';

const fixedDate = (value) => new Date(`2026-03-01T${value.includes('.') ? value : `${value}.000`}Z`);

function integrationFixture(overrides = {}) {
  return new Integration({
    id: 'integration-test',
    name: 'Integration Test',
    providerKey: 'test-provider',
    configurationReference: 'config:test:default',
    secretReference: 'vault:test:credential',
    createdAt: fixedDate('10:00:00'),
    ...overrides
  });
}

function executionFixture(overrides = {}) {
  return new Execution({
    id: 'execution-test',
    integrationId: 'integration-test',
    operationName: 'records.create',
    input: { record: { name: 'Example' } },
    idempotencyKey: 'request-12345678',
    retryPolicy: new RetryPolicy({ maxAttempts: 3, initialDelayMs: 1_000, maxDelayMs: 5_000 }),
    createdAt: fixedDate('10:01:00'),
    ...overrides
  });
}

test('ProviderKey normaliza e valida o identificador', () => {
  assert.equal(new ProviderKey('  EXAMPLE-SERVICE ').value, 'example-service');
  assert.throws(() => new ProviderKey('not a provider'), ValidationError);
});

test('Integration começa inativa e precisa ser ativada explicitamente', () => {
  const integration = integrationFixture();
  assert.equal(integration.status, 'inactive');
  assert.throws(() => integration.assertCanExecute(), IntegrationInactiveError);
  integration.activate(fixedDate('10:02:00'));
  assert.doesNotThrow(() => integration.assertCanExecute());
});

test('Integration armazena referências, não valores secretos', () => {
  const json = integrationFixture().toJSON();
  assert.equal(json.secretReference, 'vault:test:credential');
  assert.equal(Object.hasOwn(json, 'secret'), false);
  assert.equal(Object.hasOwn(json, 'apiKey'), false);
});

test('RetryPolicy aplica backoff exponencial com limite', () => {
  const policy = new RetryPolicy({ maxAttempts: 5, initialDelayMs: 1_000, maxDelayMs: 3_000, backoffMultiplier: 2 });
  assert.deepEqual([1, 2, 3, 4].map((attempt) => policy.delayForAttempt(attempt)), [1_000, 2_000, 3_000, 3_000]);
  assert.equal(policy.canRetryAfter(4), true);
  assert.equal(policy.canRetryAfter(5), false);
});

test('Execution protege o input e conclui com sucesso', () => {
  const execution = executionFixture();
  const copy = execution.input;
  copy.record.name = 'Changed';
  assert.equal(execution.input.record.name, 'Example');
  execution.startAttempt(fixedDate('10:01:01'));
  execution.succeed({ completedAt: fixedDate('10:01:02') });
  assert.equal(execution.status, ExecutionStatus.SUCCEEDED);
});

test('Execution agenda retry e bloqueia início antes do horário', () => {
  const execution = executionFixture();
  execution.startAttempt(fixedDate('10:01:01'));
  execution.fail({ failedAt: fixedDate('10:01:02'), errorCode: 'temporary_failure' });
  assert.equal(execution.status, ExecutionStatus.RETRY_SCHEDULED);
  assert.equal(execution.nextAttemptAt.toISOString(), '2026-03-01T10:01:03.000Z');
  assert.throws(() => execution.startAttempt(fixedDate('10:01:02.999')), BusinessRuleError);
  execution.startAttempt(fixedDate('10:01:03'));
  assert.equal(execution.attemptCount, 2);
});

test('Execution encerra falha não repetível e permite cancelamento pendente', () => {
  const failed = executionFixture();
  failed.startAttempt(fixedDate('10:01:01'));
  failed.fail({ failedAt: fixedDate('10:01:02'), errorCode: 'invalid_request', retryable: false });
  assert.equal(failed.status, ExecutionStatus.FAILED);

  const cancelled = executionFixture({ id: 'execution-cancelled' });
  cancelled.cancel(fixedDate('10:01:01'));
  assert.equal(cancelled.status, ExecutionStatus.CANCELLED);
});

test('Execution reconstitui histórico persistido e rejeita inconsistência', () => {
  const restored = Execution.reconstitute({
    id: 'execution-restored',
    integrationId: 'integration-test',
    operationName: 'records.create',
    createdAt: fixedDate('10:01:00'),
    status: ExecutionStatus.SUCCEEDED,
    attempts: [
      { number: 1, status: 'failed', startedAt: fixedDate('10:01:01'), endedAt: fixedDate('10:01:02'), errorCode: 'TEMPORARY_FAILURE' },
      { number: 2, status: 'succeeded', startedAt: fixedDate('10:01:03'), endedAt: fixedDate('10:01:04'), errorCode: null }
    ],
    completedAt: fixedDate('10:01:04'),
    retryPolicy: { maxAttempts: 3, initialDelayMs: 1_000, maxDelayMs: 5_000, backoffMultiplier: 2 }
  });
  assert.equal(restored.status, ExecutionStatus.SUCCEEDED);
  assert.equal(restored.attemptCount, 2);

  assert.throws(() => Execution.reconstitute({
    id: 'execution-invalid',
    integrationId: 'integration-test',
    operationName: 'records.create',
    createdAt: fixedDate('10:01:00'),
    status: ExecutionStatus.PENDING,
    attempts: [{ number: 1, status: 'running', startedAt: fixedDate('10:01:01'), endedAt: null }]
  }), ValidationError);
});

test('Execution rejeita dados que não são JSON', () => {
  assert.throws(() => executionFixture({ input: { unsupported: 1n } }), ValidationError);
});
