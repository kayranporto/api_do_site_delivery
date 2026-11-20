import test from 'node:test';
import assert from 'node:assert/strict';
import { Execution } from '../../src/domain/entities/Execution.js';
import { GetExecution } from '../../src/application/use-cases/GetExecution.js';
import { InMemoryExecutionRepository } from '../../src/infrastructure/repositories/InMemoryExecutionRepository.js';
import { NotFoundError } from '../../src/application/errors/NotFoundError.js';

test('GetExecution consulta a execução por ID e retorna NotFound para IDs ausentes', async () => {
  const repository = new InMemoryExecutionRepository();
  const execution = new Execution({
    id: 'execution-get-test',
    integrationId: 'integration-get-test',
    operationName: 'records.create',
    createdAt: new Date('2026-04-01T00:00:00.000Z')
  });
  await repository.save(execution);

  const useCase = new GetExecution({ executionRepository: repository });
  const found = await useCase.execute({ executionId: execution.id });
  assert.equal(found.id, execution.id);
  await assert.rejects(() => useCase.execute({ executionId: 'missing' }), NotFoundError);
});
