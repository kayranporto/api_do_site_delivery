import test from 'node:test';
import assert from 'node:assert/strict';
import { Execution, ExecutionStatus } from '../../src/domain/entities/Execution.js';
import { InMemoryExecutionRepository } from '../../src/infrastructure/repositories/InMemoryExecutionRepository.js';
import { RecoverStaleExecutions } from '../../src/application/use-cases/RecoverStaleExecutions.js';
import { createWorker } from '../../src/worker/createWorker.js';

function makeExecution(id, createdAt = new Date('2026-05-01T10:00:00.000Z')) {
  return new Execution({
    id,
    integrationId: 'integration-worker-test',
    operationName: 'records.create',
    idempotencyKey: null,
    createdAt
  });
}

test('Execution interrompe uma execução pending e reconstitui o estado final', () => {
  const execution = makeExecution('pending-interruption');
  execution.interrupt(new Date('2026-05-01T10:05:00.000Z'));

  assert.equal(execution.status, ExecutionStatus.INTERRUPTED);
  assert.equal(execution.isFinal, true);
  assert.equal(execution.attemptCount, 0);
  const restored = Execution.reconstitute(execution.toJSON());
  assert.equal(restored.status, ExecutionStatus.INTERRUPTED);
});

test('Execution interrompe uma tentativa running sem marcar sucesso ou retry automático', () => {
  const execution = makeExecution('running-interruption');
  execution.startAttempt(new Date('2026-05-01T10:00:01.000Z'));
  execution.interrupt(new Date('2026-05-01T10:02:00.000Z'));

  assert.equal(execution.status, ExecutionStatus.INTERRUPTED);
  assert.equal(execution.attempts[0].status, 'failed');
  assert.equal(execution.attempts[0].errorCode, 'EXECUTION_INTERRUPTED');
  assert.equal(execution.nextAttemptAt, null);
  assert.equal(Execution.reconstitute(execution.toJSON()).status, ExecutionStatus.INTERRUPTED);
});

test('RecoverStaleExecutions move somente execuções antigas para interrupted', async () => {
  const repository = new InMemoryExecutionRepository();
  const pending = makeExecution('stale-pending');
  const running = makeExecution('stale-running');
  running.startAttempt(new Date('2026-05-01T10:00:01.000Z'));
  const recent = makeExecution('recent-pending', new Date('2026-06-01T09:59:55.000Z'));
  await repository.save(pending);
  await repository.save(running);
  await repository.save(recent);

  const now = new Date('2026-06-01T10:00:00.000Z');
  const useCase = new RecoverStaleExecutions({
    executionRepository: repository,
    clock: { now: () => new Date(now) },
    staleAfterMs: 10_000,
    leaseMs: 30_000
  });
  const result = await useCase.execute({ limit: 10 });

  assert.equal(result.recovered, 2);
  assert.equal((await repository.findById('stale-pending')).status, ExecutionStatus.INTERRUPTED);
  assert.equal((await repository.findById('stale-running')).status, ExecutionStatus.INTERRUPTED);
  assert.equal((await repository.findById('recent-pending')).status, ExecutionStatus.PENDING);
});

test('InMemoryExecutionRepository usa fencing token para rejeitar worker antigo', async () => {
  const repository = new InMemoryExecutionRepository();
  const execution = makeExecution('fenced-execution');
  await repository.createIfAbsent(execution);
  const firstOwner = await repository.findById(execution.id);
  assert.equal(await repository.acquireLease(firstOwner, 1_000), true);
  firstOwner.startAttempt(new Date());
  await repository.save(firstOwner, { releaseLease: false });

  const future = new Date(Date.now() + 2_000);
  const secondOwner = await repository.claimStaleExecutions(
    future,
    future,
    1,
    10_000
  );
  assert.equal(secondOwner.length, 1);
  firstOwner.fail({
    failedAt: new Date(Date.now() + 1),
    errorCode: 'TEMPORARY_FAILURE',
    retryable: false
  });
  await assert.rejects(
    () => repository.save(firstOwner),
    (error) => error.code === 'EXECUTION_LEASE_LOST'
  );
});

test('Worker não sobrepõe ciclos e aguarda o processamento quando recebe stop', async () => {
  let resolveRecovery;
  let recoveryCalls = 0;
  const worker = createWorker({
    intervalMs: 250,
    useCases: {
      recoverStaleExecutions: {
        async execute() {
          recoveryCalls += 1;
          await new Promise((resolve) => { resolveRecovery = resolve; });
          return { recovered: 0, total: 0 };
        }
      },
      retryDueExecutions: { async execute() { return { processed: 0, total: 0 }; } }
    },
    logger: { info() {}, error() {} }
  });

  const first = worker.runOnce();
  const second = worker.runOnce();
  await Promise.resolve();
  assert.equal(recoveryCalls, 1);

  let stopped = false;
  const stopping = worker.stop().then(() => { stopped = true; });
  await Promise.resolve();
  assert.equal(stopped, false);
  resolveRecovery();
  await Promise.all([first, second, stopping]);
  assert.equal(stopped, true);
  assert.equal(worker.isRunning, false);
});
