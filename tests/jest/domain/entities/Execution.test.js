import { describe, expect, test } from '@jest/globals';
import { Execution, ExecutionStatus } from '../../../../src/domain/entities/Execution.js';
import { BusinessRuleError } from '../../../../src/domain/errors/BusinessRuleError.js';
import { InvalidStateTransitionError } from '../../../../src/domain/errors/InvalidStateTransitionError.js';
import { RetryPolicy } from '../../../../src/domain/value-objects/RetryPolicy.js';
import { ValidationError } from '../../../../src/domain/errors/ValidationError.js';
import vm from 'node:vm';

const createdAt = new Date('2026-02-01T12:00:00.000Z');

function makeExecution(overrides = {}) {
  return new Execution({
    id: 'execution-01',
    integrationId: 'integration-01',
    operationName: 'customer.create',
    input: { customer: { email: 'person@example.test' } },
    idempotencyKey: 'request-12345678',
    retryPolicy: new RetryPolicy({ maxAttempts: 3, initialDelayMs: 1_000, maxDelayMs: 5_000 }),
    createdAt,
    ...overrides
  });
}

describe('Execution', () => {
  test('cria uma execução pendente e protege o input contra mutações externas', () => {
    const execution = makeExecution();
    const receivedInput = execution.input;
    receivedInput.customer.email = 'changed@example.test';

    expect(execution.status).toBe(ExecutionStatus.PENDING);
    expect(execution.input.customer.email).toBe('person@example.test');
  });

  test('conclui uma tentativa com sucesso', () => {
    const execution = makeExecution();
    execution.startAttempt(new Date('2026-02-01T12:00:01.000Z'));
    execution.succeed({ completedAt: new Date('2026-02-01T12:00:02.000Z') });

    expect(execution.status).toBe(ExecutionStatus.SUCCEEDED);
    expect(execution.attemptCount).toBe(1);
    expect(execution.isFinal).toBe(true);
    expect(execution.attempts[0].status).toBe('succeeded');
  });

  test('agenda nova tentativa respeitando backoff e só libera no horário', () => {
    const execution = makeExecution();
    execution.startAttempt(new Date('2026-02-01T12:00:01.000Z'));
    execution.fail({
      failedAt: new Date('2026-02-01T12:00:02.000Z'),
      errorCode: 'provider_unavailable',
      retryable: true
    });

    expect(execution.status).toBe(ExecutionStatus.RETRY_SCHEDULED);
    expect(execution.nextAttemptAt.toISOString()).toBe('2026-02-01T12:00:03.000Z');
    expect(() => execution.startAttempt(new Date('2026-02-01T12:00:02.999Z'))).toThrow(BusinessRuleError);

    execution.startAttempt(new Date('2026-02-01T12:00:03.000Z'));
    expect(execution.status).toBe(ExecutionStatus.RUNNING);
    expect(execution.attemptCount).toBe(2);
  });

  test('encerra a execução quando a falha não permite retry', () => {
    const execution = makeExecution();
    execution.startAttempt(new Date('2026-02-01T12:00:01.000Z'));
    execution.fail({
      failedAt: new Date('2026-02-01T12:00:02.000Z'),
      errorCode: 'INVALID_REQUEST',
      retryable: false
    });

    expect(execution.status).toBe(ExecutionStatus.FAILED);
    expect(execution.completedAt.toISOString()).toBe('2026-02-01T12:00:02.000Z');
  });

  test('não ultrapassa o total máximo de tentativas', () => {
    const execution = makeExecution({ retryPolicy: new RetryPolicy({ maxAttempts: 1 }) });
    execution.startAttempt(new Date('2026-02-01T12:00:01.000Z'));
    execution.fail({
      failedAt: new Date('2026-02-01T12:00:02.000Z'),
      errorCode: 'TEMPORARY_FAILURE',
      retryable: true
    });

    expect(execution.status).toBe(ExecutionStatus.FAILED);
    expect(() => execution.startAttempt(new Date('2026-02-01T12:00:03.000Z'))).toThrow(InvalidStateTransitionError);
    expect(execution.attemptCount).toBe(1);
  });

  test('permite cancelar uma execução pendente', () => {
    const execution = makeExecution();
    execution.cancel(new Date('2026-02-01T12:00:01.000Z'));
    expect(execution.status).toBe(ExecutionStatus.CANCELLED);
    expect(execution.isFinal).toBe(true);
  });

  test('aceita objetos simples criados em outro contexto JavaScript e rejeita instâncias de classe', () => {
    const crossRealmInput = vm.runInNewContext('({ customer: { email: "person@example.test" } })');
    const execution = makeExecution({ input: crossRealmInput });
    expect(execution.input.customer.email).toBe('person@example.test');
    expect(() => makeExecution({ input: { createdAt: new Date() } })).toThrow(ValidationError);
  });

  test('rejeita input que não seja JSON estruturado', () => {
    expect(() => makeExecution({ input: 'texto simples' })).toThrow(ValidationError);
    expect(() => makeExecution({ input: { value: 1n } })).toThrow(ValidationError);
  });


  test('reconstitui uma execução a partir do histórico persistido', () => {
    const persisted = {
      id: 'execution-02',
      integrationId: 'integration-01',
      operationName: 'customer.create',
      input: { customer: { email: 'person@example.test' } },
      idempotencyKey: 'request-87654321',
      retryPolicy: { maxAttempts: 3, initialDelayMs: 1_000, maxDelayMs: 5_000, backoffMultiplier: 2 },
      createdAt: createdAt.toISOString(),
      status: ExecutionStatus.SUCCEEDED,
      attempts: [
        { number: 1, status: 'failed', startedAt: '2026-02-01T12:00:01.000Z', endedAt: '2026-02-01T12:00:02.000Z', errorCode: 'PROVIDER_UNAVAILABLE' },
        { number: 2, status: 'succeeded', startedAt: '2026-02-01T12:00:03.000Z', endedAt: '2026-02-01T12:00:04.000Z', errorCode: null }
      ],
      nextAttemptAt: null,
      completedAt: '2026-02-01T12:00:04.000Z'
    };

    const restored = Execution.reconstitute(persisted);
    expect(restored.status).toBe(ExecutionStatus.SUCCEEDED);
    expect(restored.attemptCount).toBe(2);
    expect(restored.toJSON().attempts[0].errorCode).toBe('PROVIDER_UNAVAILABLE');
  });

  test('rejeita histórico persistido inconsistente', () => {
    expect(() => Execution.reconstitute({
      id: 'execution-03',
      integrationId: 'integration-01',
      operationName: 'customer.create',
      createdAt,
      status: ExecutionStatus.PENDING,
      attempts: [{ number: 1, status: 'running', startedAt: new Date(), endedAt: null }]
    })).toThrow(ValidationError);
  });

  test('não permite concluir sem uma tentativa em andamento', () => {
    const execution = makeExecution();
    expect(() => execution.succeed()).toThrow(InvalidStateTransitionError);
  });
});
