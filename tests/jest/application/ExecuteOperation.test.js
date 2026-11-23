import { describe, expect, test } from '@jest/globals';
import { Integration } from '../../../src/domain/entities/Integration.js';
import { ExecutionStatus } from '../../../src/domain/entities/Execution.js';
import { ExecuteOperation } from '../../../src/application/use-cases/ExecuteOperation.js';
import { IdempotencyConflictError } from '../../../src/application/errors/IdempotencyConflictError.js';

class IntegrationRepositoryFake {
  constructor(integration) { this.integration = integration; }
  async findById(id) { return id === this.integration.id ? this.integration : null; }
}

class ExecutionRepositoryFake {
  items = new Map();
  async save(execution) { this.items.set(execution.id, execution); }
  async createIfAbsent(execution) {
    const existing = await this.findByIdempotencyKey(execution.integrationId, execution.idempotencyKey?.value);
    if (existing) return { created: false, execution: existing };
    this.items.set(execution.id, execution);
    return { created: true, execution };
  }
  async findByIdempotencyKey(integrationId, key) {
    return [...this.items.values()].find((item) => item.integrationId === integrationId
      && item.idempotencyKey?.value === key) ?? null;
  }
}

function makeContext() {
  const integration = new Integration({
    id: 'integration-jest',
    name: 'Jest Provider',
    providerKey: 'jest-provider',
    configurationReference: 'config:jest:default',
    status: 'active',
    createdAt: new Date('2026-04-01T00:00:00.000Z')
  });
  const integrationRepository = new IntegrationRepositoryFake(integration);
  const executionRepository = new ExecutionRepositoryFake();
  let id = 0;
  let timestamp = new Date('2026-04-01T00:01:00.000Z');
  const clock = { now: () => { const current = new Date(timestamp); timestamp = new Date(timestamp.getTime() + 1_000); return current; } };
  const idGenerator = { generate: () => `exec-${++id}` };
  let providerCalls = 0;
  const providerRegistry = {
    async resolve(key) {
      expect(key).toBe('jest-provider');
      return { async execute() { providerCalls += 1; return { accepted: true }; } };
    }
  };
  const useCase = new ExecuteOperation({ integrationRepository, executionRepository, providerRegistry, idGenerator, clock });
  return { useCase, executionRepository, get providerCalls() { return providerCalls; } };
}

describe('ExecuteOperation', () => {
  test('persiste a execução e devolve o resultado do adaptador', async () => {
    const context = makeContext();
    const outcome = await context.useCase.execute({
      integrationId: 'integration-jest',
      operationName: 'records.create',
      payload: { value: 1 },
      idempotencyKey: 'jest-request-1234'
    });

    expect(outcome.execution.status).toBe(ExecutionStatus.SUCCEEDED);
    expect(outcome.result).toEqual({ accepted: true });
    expect(outcome.replayed).toBe(false);
    expect(context.executionRepository.items.size).toBe(1);
  });

  test('não repete o provedor e rejeita reutilização da chave com payload diferente', async () => {
    const context = makeContext();
    const command = {
      integrationId: 'integration-jest',
      operationName: 'records.create',
      payload: { value: 1 },
      idempotencyKey: 'jest-request-5678'
    };

    const first = await context.useCase.execute(command);
    const replay = await context.useCase.execute(command);
    expect(replay.execution.id).toBe(first.execution.id);
    expect(replay.replayed).toBe(true);
    expect(context.providerCalls).toBe(1);
    await expect(context.useCase.execute({ ...command, payload: { value: 2 } }))
      .rejects.toBeInstanceOf(IdempotencyConflictError);
    expect(context.providerCalls).toBe(1);
  });
});
