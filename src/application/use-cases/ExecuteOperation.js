import { Execution } from '../../domain/entities/Execution.js';
import { IdempotencyKey } from '../../domain/value-objects/IdempotencyKey.js';
import { OperationName } from '../../domain/value-objects/OperationName.js';
import { NotFoundError } from '../errors/NotFoundError.js';
import { IdempotencyConflictError } from '../errors/IdempotencyConflictError.js';
import { InvalidProviderAdapterError } from '../errors/InvalidProviderAdapterError.js';
import { executeProviderAttempt } from '../services/executeProviderAttempt.js';

function stableJson(value) {
  if (value === null || typeof value !== 'object') {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new TypeError('Payload não pode ser serializado como JSON.');
    return serialized;
  }
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((key) => JSON.stringify(key) + ':' + stableJson(value[key])).join(',') + '}';
}

function sameCommand(existing, candidate) {
  return existing.operationName.value === candidate.operationName.value
    && stableJson(existing.input) === stableJson(candidate.input);
}

function replayOrConflict(existing, candidate, integrationId) {
  if (!sameCommand(existing, candidate)) {
    throw new IdempotencyConflictError(integrationId);
  }
  return { execution: existing, result: null, replayed: true };
}

export class ExecuteOperation {
  constructor({ integrationRepository, executionRepository, providerRegistry, idGenerator, clock, leaseMs = 180_000 }) {
    this.integrationRepository = integrationRepository;
    this.executionRepository = executionRepository;
    this.providerRegistry = providerRegistry;
    this.idGenerator = idGenerator;
    this.clock = clock;
    this.leaseMs = leaseMs;
  }

  async execute(input) {
    const integration = await this.integrationRepository.findById(input.integrationId);
    if (!integration) throw new NotFoundError('Integração', input.integrationId);
    integration.assertCanExecute();

    const operationName = new OperationName(input.operationName);
    const idempotencyKey = input.idempotencyKey == null
      ? null
      : new IdempotencyKey(input.idempotencyKey);

    const execution = new Execution({
      id: this.idGenerator.generate(),
      integrationId: integration.id,
      operationName,
      input: input.payload ?? null,
      idempotencyKey,
      retryPolicy: integration.retryPolicy,
      createdAt: this.clock.now()
    });

    // Atalho para replay: não exige que o adaptador do provedor ainda esteja disponível.
    if (idempotencyKey) {
      const existing = await this.executionRepository.findByIdempotencyKey(
        integration.id,
        idempotencyKey.value
      );
      if (existing) return replayOrConflict(existing, execution, integration.id);
    }

    const providerKey = integration.providerKey.value;
    const adapter = await this.providerRegistry.resolve(providerKey);
    if (!adapter || typeof adapter.execute !== 'function') {
      throw new InvalidProviderAdapterError(providerKey);
    }

    // A reserva atômica fecha a corrida entre o atalho acima e o início do efeito externo.
    const reservation = await this.executionRepository.createIfAbsent(execution);
    if (!reservation.created) {
      return replayOrConflict(reservation.execution, execution, integration.id);
    }

    let activeExecution = reservation.execution;
    if (typeof this.executionRepository.acquireLease === 'function') {
      const acquired = await this.executionRepository.acquireLease(activeExecution, this.leaseMs ?? 180_000);
      if (!acquired) {
        const current = await this.executionRepository.findById(activeExecution.id);
        if (current) return replayOrConflict(current, execution, integration.id);
        throw new Error('Não foi possível adquirir o lease da execução.');
      }
    }

    const outcome = await executeProviderAttempt({
      execution: activeExecution,
      integration,
      adapter,
      executionRepository: this.executionRepository,
      clock: this.clock,
      leaseMs: this.leaseMs ?? 180_000
    });

    return { ...outcome, replayed: false };
  }
}
