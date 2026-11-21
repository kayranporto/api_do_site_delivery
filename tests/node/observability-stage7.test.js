import test from 'node:test';
import assert from 'node:assert/strict';
import { Integration } from '../../src/domain/entities/Integration.js';
import { Execution, ExecutionStatus } from '../../src/domain/entities/Execution.js';
import { InMemoryIntegrationRepository } from '../../src/infrastructure/repositories/InMemoryIntegrationRepository.js';
import { InMemoryExecutionRepository } from '../../src/infrastructure/repositories/InMemoryExecutionRepository.js';
import { InMemoryOperationalEventRepository } from '../../src/infrastructure/repositories/InMemoryOperationalEventRepository.js';
import { PostgresOperationalEventRepository } from '../../src/infrastructure/repositories/PostgresOperationalEventRepository.js';
import { ReconcileInterruptedExecution } from '../../src/application/use-cases/ReconcileInterruptedExecution.js';
import { GetOperationalMetrics } from '../../src/application/use-cases/GetOperationalMetrics.js';
import { GetExecutionEvents } from '../../src/application/use-cases/GetExecutionEvents.js';

function makeIntegration() {
  return new Integration({
    id: 'integration-observability',
    name: 'Observability test',
    providerKey: 'reconcile-provider',
    configurationReference: 'config:reconcile:default',
    secretReference: null,
    status: 'active',
    createdAt: new Date('2026-07-01T10:00:00.000Z')
  });
}

function makeInterruptedExecution() {
  const execution = new Execution({
    id: 'execution-observability',
    integrationId: 'integration-observability',
    operationName: 'records.create',
    input: { customer: 'private data should not appear in events' },
    idempotencyKey: 'request-observability-1234',
    createdAt: new Date('2026-07-01T10:00:00.000Z')
  });
  execution.startAttempt(new Date('2026-07-01T10:00:01.000Z'));
  execution.interrupt(new Date('2026-07-01T10:01:00.000Z'));
  return execution;
}

function fixedClock(value = '2026-07-01T10:05:00.000Z') {
  const date = new Date(value);
  return { now: () => new Date(date) };
}

async function setup() {
  const integrationRepository = new InMemoryIntegrationRepository();
  const executionRepository = new InMemoryExecutionRepository();
  const eventRepository = new InMemoryOperationalEventRepository();
  const integration = makeIntegration();
  const execution = makeInterruptedExecution();
  await integrationRepository.save(integration);
  await executionRepository.save(execution);
  return { integrationRepository, executionRepository, eventRepository, integration, execution };
}

test('InMemoryOperationalEventRepository filtra detalhes e retorna trilha de auditoria ordenada', async () => {
  const repository = new InMemoryOperationalEventRepository();
  const event = await repository.append({
    executionId: 'execution-1',
    integrationId: 'integration-1',
    eventType: 'execution.attempt_failed',
    severity: 'warning',
    details: {
      attempt: 2,
      errorCode: 'PROVIDER_TIMEOUT',
      retryable: true,
      payload: { secret: 'do-not-store' },
      accessToken: 'never-store'
    },
    createdAt: new Date('2026-07-01T10:00:00.000Z')
  });

  assert.equal(event.details.attempt, 2);
  assert.equal(event.details.errorCode, 'PROVIDER_TIMEOUT');
  assert.equal(Object.hasOwn(event.details, 'payload'), false);
  assert.equal(Object.hasOwn(event.details, 'accessToken'), false);
  assert.equal((await repository.findByExecutionId('execution-1')).length, 1);
  assert.deepEqual(await repository.countSince(new Date('2026-07-01T09:00:00.000Z')), {
    total: 1,
    byType: { 'execution.attempt_failed': 1 },
    bySeverity: { warning: 1 }
  });
  await assert.rejects(() => repository.append({
    executionId: 'execution-1',
    integrationId: 'integration-1',
    eventType: 'arbitrary.event',
    details: {}
  }), /eventType não permitido/);
});

test('ReconcileInterruptedExecution registra resultado externo sem alterar o estado interrupted', async () => {
  const context = await setup();
  const providerRegistry = {
    async resolve() {
      return {
        async reconcile(command) {
          assert.equal(command.executionId, context.execution.id);
          assert.equal(command.idempotencyKey, 'request-observability-1234');
          return { outcome: 'succeeded', providerStatus: 'completed' };
        }
      };
    }
  };
  const useCase = new ReconcileInterruptedExecution({
    ...context,
    providerRegistry,
    clock: fixedClock()
  });

  const result = await useCase.execute({ executionId: context.execution.id });
  assert.equal(result.outcome, 'succeeded');
  assert.equal(result.executionStatus, ExecutionStatus.INTERRUPTED);
  assert.equal((await context.executionRepository.findById(context.execution.id)).status, ExecutionStatus.INTERRUPTED);
  const events = await context.eventRepository.findByExecutionId(context.execution.id);
  assert.deepEqual(events.map((event) => event.eventType), [
    'execution.reconciliation_requested',
    'execution.reconciliation_completed'
  ]);
  assert.equal(events[1].details.providerStatus, 'completed');
});

test('ReconcileInterruptedExecution trata provedor sem suporte como unsupported, sem efeito externo', async () => {
  const context = await setup();
  const useCase = new ReconcileInterruptedExecution({
    ...context,
    providerRegistry: { async resolve() { return { async execute() { assert.fail('não deve executar'); } }; } },
    clock: fixedClock()
  });
  const result = await useCase.execute({ executionId: context.execution.id });
  assert.equal(result.outcome, 'unsupported');
  assert.equal(result.reason, 'provider_reconciliation_not_supported');
  assert.equal((await context.executionRepository.findById(context.execution.id)).status, ExecutionStatus.INTERRUPTED);
  const events = await context.eventRepository.findByExecutionId(context.execution.id);
  assert.equal(events.some((event) => event.eventType === 'execution.reconciliation_unsupported'), true);
});

test('ReconcileInterruptedExecution rejeita execuções que não estão interrupted', async () => {
  const context = await setup();
  const pending = new Execution({
    id: 'pending-execution',
    integrationId: context.integration.id,
    operationName: 'records.create',
    createdAt: new Date('2026-07-01T10:00:00.000Z')
  });
  await context.executionRepository.save(pending);
  const useCase = new ReconcileInterruptedExecution({
    ...context,
    providerRegistry: { async resolve() { return { async reconcile() { return { outcome: 'succeeded' }; } }; } },
    clock: fixedClock()
  });
  await assert.rejects(
    () => useCase.execute({ executionId: pending.id }),
    (error) => error.code === 'EXECUTION_NOT_INTERRUPTED'
  );
});

test('GetOperationalMetrics agrega estados e eventos na janela solicitada', async () => {
  const context = await setup();
  await context.eventRepository.append({
    executionId: context.execution.id,
    integrationId: context.integration.id,
    eventType: 'execution.interrupted',
    severity: 'warning',
    details: { status: 'interrupted' },
    createdAt: new Date('2026-07-01T10:04:00.000Z')
  });
  const useCase = new GetOperationalMetrics({
    ...context,
    clock: fixedClock()
  });
  const result = await useCase.execute({ windowHours: 1 });
  assert.equal(result.executionsByStatus.interrupted, 1);
  assert.equal(result.events.total, 1);
  assert.equal(result.events.byType['execution.interrupted'], 1);
  await assert.rejects(() => useCase.execute({ windowHours: 721 }), RangeError);
});

test('GetExecutionEvents exige execução existente e aplica limite', async () => {
  const context = await setup();
  await context.eventRepository.append({
    executionId: context.execution.id,
    integrationId: context.integration.id,
    eventType: 'execution.reconciliation_requested',
    details: {},
    createdAt: new Date('2026-07-01T10:04:00.000Z')
  });
  const useCase = new GetExecutionEvents(context);
  assert.equal((await useCase.execute({ executionId: context.execution.id, limit: 10 })).length, 1);
  await assert.rejects(() => useCase.execute({ executionId: 'missing' }), /não encontrado/);
  await assert.rejects(() => useCase.execute({ executionId: context.execution.id, limit: 501 }), RangeError);
});

test('PostgresOperationalEventRepository usa SQL parametrizado e agrega métricas', async () => {
  const calls = [];
  const pool = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.startsWith('INSERT')) {
        return { rows: [{
          id: values[0],
          execution_id: values[1],
          integration_id: values[2],
          event_type: values[3],
          severity: values[4],
          details: JSON.parse(values[5]),
          created_at: values[6]
        }] };
      }
      if (sql.includes('COUNT(*)::integer AS total')) return { rows: [{ total: 4 }] };
      if (sql.includes('GROUP BY event_type')) return { rows: [{ event_type: 'execution.attempt_failed', count: 3 }] };
      if (sql.includes('GROUP BY severity')) return { rows: [{ severity: 'error', count: 4 }] };
      if (sql.includes('ORDER BY created_at DESC')) return { rows: [] };
      throw new Error('SQL inesperado no teste.');
    }
  };
  const repository = new PostgresOperationalEventRepository({ pool });
  const event = await repository.append({
    executionId: 'execution-1',
    integrationId: 'integration-1',
    eventType: 'execution.attempt_started',
    details: { attempt: 1, payload: { private: true } },
    createdAt: new Date('2026-07-01T10:00:00.000Z')
  });
  assert.equal(event.eventType, 'execution.attempt_started');
  assert.equal(Object.hasOwn(event.details, 'payload'), false);
  assert.match(calls[0].sql, /VALUES \(\$1, \$2, \$3, \$4, \$5, \$6::jsonb, \$7\)/);
  const counts = await repository.countSince(new Date('2026-07-01T09:00:00.000Z'));
  assert.equal(counts.total, 4);
  assert.deepEqual(counts.byType, { 'execution.attempt_failed': 3 });
  assert.deepEqual(counts.bySeverity, { error: 4 });
});
