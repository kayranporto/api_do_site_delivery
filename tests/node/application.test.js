import test from 'node:test';
import assert from 'node:assert/strict';
import { Integration } from '../../src/domain/entities/Integration.js';
import { ExecutionStatus } from '../../src/domain/entities/Execution.js';
import { RetryPolicy } from '../../src/domain/value-objects/RetryPolicy.js';
import { IntegrationInactiveError } from '../../src/domain/errors/IntegrationInactiveError.js';
import { ProviderExecutionError } from '../../src/application/errors/ProviderExecutionError.js';
import { ProviderNotFoundError } from '../../src/application/errors/ProviderNotFoundError.js';
import { NotFoundError } from '../../src/application/errors/NotFoundError.js';
import { InvalidProviderAdapterError } from '../../src/application/errors/InvalidProviderAdapterError.js';
import { IdempotencyConflictError } from '../../src/application/errors/IdempotencyConflictError.js';
import {
  ActivateIntegration,
  CancelExecution,
  CreateIntegration,
  DeactivateIntegration,
  ExecuteOperation,
  GetIntegration,
  ListActiveIntegrations,
  RetryDueExecutions
} from '../../src/application/index.js';

class MemoryIntegrationRepository {
  items = new Map();
  async save(integration) { this.items.set(integration.id, integration); return integration; }
  async findById(id) { return this.items.get(id) ?? null; }
  async findByProviderKey(key) {
    return [...this.items.values()].filter((item) => item.providerKey.value === String(key));
  }
  async listActive() { return [...this.items.values()].filter((item) => item.isActive); }
}

class MemoryExecutionRepository {
  items = new Map();
  async save(execution) { this.items.set(execution.id, execution); return execution; }
  async createIfAbsent(execution) {
    const key = execution.idempotencyKey?.value;
    const existing = key == null ? null : [...this.items.values()].find((item) => (
      item.integrationId === execution.integrationId && item.idempotencyKey?.value === key
    ));
    if (existing) return { execution: existing, created: false };
    this.items.set(execution.id, execution);
    return { execution, created: true };
  }
  async findById(id) { return this.items.get(id) ?? null; }
  async findByIdempotencyKey(integrationId, key) {
    return [...this.items.values()].find((item) => item.integrationId === integrationId
      && item.idempotencyKey?.value === key) ?? null;
  }
  async findDueForRetry(now, limit) {
    return [...this.items.values()]
      .filter((item) => item.status === ExecutionStatus.RETRY_SCHEDULED && item.nextAttemptAt <= now)
      .sort((a, b) => a.nextAttemptAt - b.nextAttemptAt)
      .slice(0, limit);
  }
}

class FakeClock {
  constructor(start = '2026-04-01T10:00:00.000Z') { this.current = new Date(start); }
  now() {
    const result = new Date(this.current);
    this.current = new Date(this.current.getTime() + 1_000);
    return result;
  }
  advance(milliseconds) { this.current = new Date(this.current.getTime() + milliseconds); }
}

class FakeIdGenerator {
  next = 0;
  generate() { this.next += 1; return 'generated-' + this.next; }
}

class FakeProviderRegistry {
  constructor(adapters = {}) { this.adapters = new Map(Object.entries(adapters)); }
  async resolve(providerKey) {
    const adapter = this.adapters.get(providerKey);
    if (!adapter) throw new ProviderNotFoundError(providerKey);
    return adapter;
  }
}

function setup({ active = true, retryPolicy = new RetryPolicy({ maxAttempts: 2, initialDelayMs: 5_000, maxDelayMs: 10_000 }) } = {}) {
  const integrationRepository = new MemoryIntegrationRepository();
  const executionRepository = new MemoryExecutionRepository();
  const clock = new FakeClock();
  const idGenerator = new FakeIdGenerator();
  const integration = new Integration({
    id: 'integration-01',
    name: 'CRM de teste',
    providerKey: 'fake-provider',
    configurationReference: 'config:crm:default',
    secretReference: 'vault:crm:token',
    status: active ? 'active' : 'inactive',
    retryPolicy,
    createdAt: new Date('2026-04-01T09:00:00.000Z')
  });
  integrationRepository.items.set(integration.id, integration);
  return { integrationRepository, executionRepository, clock, idGenerator, integration };
}

test('CreateIntegration cria integrações inativas e persiste o agregado', async () => {
  const context = setup();
  const create = new CreateIntegration(context);
  const integration = await create.execute({
    name: 'Novo CRM',
    providerKey: 'new-provider',
    configurationReference: 'config:new:default',
    secretReference: 'vault:new:token'
  });

  assert.equal(integration.status, 'inactive');
  assert.equal(await context.integrationRepository.findById(integration.id), integration);
  assert.equal(integration.secretReference.value, 'vault:new:token');
});

test('ActivateIntegration e DeactivateIntegration aplicam regras e persistem', async () => {
  const context = setup({ active: false });
  const activate = new ActivateIntegration(context);
  const deactivate = new DeactivateIntegration(context);

  assert.equal((await activate.execute({ integrationId: 'integration-01' })).isActive, true);
  assert.equal((await deactivate.execute({ integrationId: 'integration-01' })).isActive, false);
  await assert.rejects(() => activate.execute({ integrationId: 'missing' }), NotFoundError);
});

test('GetIntegration e ListActiveIntegrations consultam somente os repositórios', async () => {
  const context = setup();
  const get = new GetIntegration(context);
  const list = new ListActiveIntegrations(context);

  assert.equal((await get.execute({ integrationId: 'integration-01' })).id, 'integration-01');
  assert.equal((await list.execute()).length, 1);
  await assert.rejects(() => get.execute({ integrationId: 'missing' }), NotFoundError);
});

test('ExecuteOperation chama o adaptador, registra execução e retorna resultado', async () => {
  const context = setup();
  let received;
  const providerRegistry = new FakeProviderRegistry({
    'fake-provider': {
      async execute(command) { received = command; return { externalId: 'ext-123' }; }
    }
  });
  const useCase = new ExecuteOperation({ ...context, providerRegistry });
  const outcome = await useCase.execute({
    integrationId: 'integration-01',
    operationName: 'records.create',
    payload: { record: { title: 'Example' } },
    idempotencyKey: 'request-12345678'
  });

  assert.equal(outcome.execution.status, ExecutionStatus.SUCCEEDED);
  assert.equal(outcome.execution.attemptCount, 1);
  assert.deepEqual(outcome.result, { externalId: 'ext-123' });
  assert.equal(outcome.replayed, false);
  assert.equal(received.integration.providerKey, 'fake-provider');
  assert.equal(received.integration.secretReference, 'vault:crm:token');
  assert.equal(received.operationName, 'records.create');
  assert.equal((await context.executionRepository.findById(outcome.execution.id)), outcome.execution);
});

test('ExecuteOperation devolve execução existente sem repetir efeito idempotente', async () => {
  const context = setup();
  let providerCalls = 0;
  const providerRegistry = new FakeProviderRegistry({
    'fake-provider': { async execute() { providerCalls += 1; return { ok: true }; } }
  });
  const useCase = new ExecuteOperation({ ...context, providerRegistry });
  const command = {
    integrationId: 'integration-01',
    operationName: 'records.create',
    payload: { title: 'Same command' },
    idempotencyKey: 'idempotency-1234'
  };

  const first = await useCase.execute(command);
  const second = await useCase.execute(command);
  assert.equal(first.execution.id, second.execution.id);
  assert.equal(second.replayed, true);
  assert.equal(providerCalls, 1);
  await assert.rejects(() => useCase.execute({ ...command, payload: { title: 'Different command' } }), IdempotencyConflictError);
  assert.equal(providerCalls, 1);
});

test('ExecuteOperation bloqueia integração inativa antes de chamar o provedor', async () => {
  const context = setup({ active: false });
  const providerRegistry = new FakeProviderRegistry({
    'fake-provider': { async execute() { assert.fail('O adaptador não deveria ser chamado.'); } }
  });
  const useCase = new ExecuteOperation({ ...context, providerRegistry });

  await assert.rejects(() => useCase.execute({
    integrationId: 'integration-01',
    operationName: 'records.create'
  }), IntegrationInactiveError);
  assert.equal(context.executionRepository.items.size, 0);
});

test('ExecuteOperation não cria execução quando não existe adaptador registrado', async () => {
  const context = setup();
  const useCase = new ExecuteOperation({
    ...context,
    providerRegistry: new FakeProviderRegistry()
  });
  await assert.rejects(() => useCase.execute({
    integrationId: 'integration-01',
    operationName: 'records.create'
  }), ProviderNotFoundError);
  assert.equal(context.executionRepository.items.size, 0);
});

test('ExecuteOperation converte falha do provedor em falha de domínio com retry agendado', async () => {
  const context = setup();
  const providerRegistry = new FakeProviderRegistry({
    'fake-provider': {
      async execute() {
        throw new ProviderExecutionError({ code: 'PROVIDER_BUSY', retryable: true });
      }
    }
  });
  const useCase = new ExecuteOperation({ ...context, providerRegistry });
  const outcome = await useCase.execute({
    integrationId: 'integration-01', operationName: 'records.create'
  });

  assert.equal(outcome.execution.status, ExecutionStatus.RETRY_SCHEDULED);
  assert.equal(outcome.execution.attempts[0].errorCode, 'PROVIDER_BUSY');
  assert.ok(outcome.execution.nextAttemptAt instanceof Date);
});

test('falha desconhecida do adaptador não é repetida automaticamente', async () => {
  const context = setup();
  const providerRegistry = new FakeProviderRegistry({
    'fake-provider': { async execute() { throw new Error('internal secret must not leak'); } }
  });
  const useCase = new ExecuteOperation({ ...context, providerRegistry });
  const outcome = await useCase.execute({
    integrationId: 'integration-01', operationName: 'records.create'
  });

  assert.equal(outcome.execution.status, ExecutionStatus.FAILED);
  assert.equal(outcome.execution.attempts[0].errorCode, 'UNEXPECTED_PROVIDER_ERROR');
  assert.equal(JSON.stringify(outcome.execution.toJSON()).includes('internal secret'), false);
});

test('RetryDueExecutions processa somente execuções vencidas e realiza nova tentativa', async () => {
  const context = setup();
  let calls = 0;
  const providerRegistry = new FakeProviderRegistry({
    'fake-provider': {
      async execute() {
        calls += 1;
        if (calls === 1) throw new ProviderExecutionError({ code: 'TEMPORARY_FAILURE', retryable: true });
        return { recovered: true };
      }
    }
  });
  const execute = new ExecuteOperation({ ...context, providerRegistry });
  const first = await execute.execute({
    integrationId: 'integration-01', operationName: 'records.create'
  });
  assert.equal(first.execution.status, ExecutionStatus.RETRY_SCHEDULED);

  const worker = new RetryDueExecutions({ ...context, providerRegistry });
  const early = await worker.execute({ limit: 10 });
  assert.equal(early.processed, 0);

  context.clock.advance(10_000);
  const retried = await worker.execute({ limit: 10 });
  assert.equal(retried.processed, 1);
  assert.equal(retried.results[0].execution.status, ExecutionStatus.SUCCEEDED);
  assert.equal(retried.results[0].execution.attemptCount, 2);
  assert.deepEqual(retried.results[0].result, { recovered: true });
});

test('RetryDueExecutions cancela execução vencida quando integração está inativa', async () => {
  const context = setup();
  const providerRegistry = new FakeProviderRegistry({
    'fake-provider': {
      async execute() { throw new ProviderExecutionError({ code: 'TEMPORARY_FAILURE', retryable: true }); }
    }
  });
  const execute = new ExecuteOperation({ ...context, providerRegistry });
  const first = await execute.execute({ integrationId: 'integration-01', operationName: 'records.create' });
  assert.equal(first.execution.status, ExecutionStatus.RETRY_SCHEDULED);
  context.integration.deactivate(context.clock.now());
  context.clock.advance(10_000);

  const worker = new RetryDueExecutions({ ...context, providerRegistry });
  const result = await worker.execute();
  assert.equal(result.results[0].outcome, 'cancelled');
  assert.equal(result.results[0].reason, 'integration_inactive');
  assert.equal(first.execution.status, ExecutionStatus.CANCELLED);
});

test('RetryDueExecutions valida limite de lote e CancelExecution cancela execução agendada', async () => {
  const context = setup();
  const providerRegistry = new FakeProviderRegistry({
    'fake-provider': {
      async execute() { throw new ProviderExecutionError({ code: 'TEMPORARY_FAILURE', retryable: true }); }
    }
  });
  const execute = new ExecuteOperation({ ...context, providerRegistry });
  const first = await execute.execute({ integrationId: 'integration-01', operationName: 'records.create' });
  const cancel = new CancelExecution(context);

  await assert.rejects(() => new RetryDueExecutions({ ...context, providerRegistry }).execute({ limit: 0 }), RangeError);
  const cancelled = await cancel.execute({ executionId: first.execution.id });
  assert.equal(cancelled.status, ExecutionStatus.CANCELLED);
  await assert.rejects(() => cancel.execute({ executionId: 'missing' }), NotFoundError);
});

test('ExecuteOperation rejeita adaptador sem contrato execute()', async () => {
  const context = setup();
  const useCase = new ExecuteOperation({
    ...context,
    providerRegistry: { async resolve() { return {}; } }
  });
  await assert.rejects(() => useCase.execute({
    integrationId: 'integration-01', operationName: 'records.create'
  }), InvalidProviderAdapterError);
  assert.equal(context.executionRepository.items.size, 0);
});
