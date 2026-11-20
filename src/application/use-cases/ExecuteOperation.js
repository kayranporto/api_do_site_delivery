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

export class ExecuteOperation {
  constructor({ integrationRepository, executionRepository, providerRegistry, idGenerator, clock }) {
    this.integrationRepository = integrationRepository;
    this.executionRepository = executionRepository;
    this.providerRegistry = providerRegistry;
    this.idGenerator = idGenerator;
    this.clock = clock;
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

    const providerKey = integration.providerKey.value;
    const adapter = await this.providerRegistry.resolve(providerKey);
    if (!adapter || typeof adapter.execute !== 'function') {
      throw new InvalidProviderAdapterError(providerKey);
    }

    // Reserva a chave e persiste o estado pending antes de qualquer efeito externo.
    // No PostgreSQL, createIfAbsent é uma única operação protegida pelo índice UNIQUE.
    const reservation = await this.executionRepository.createIfAbsent(execution);
    if (!reservation.created) {
      if (!sameCommand(reservation.execution, execution)) {
        throw new IdempotencyConflictError(integration.id);
      }
      return { execution: reservation.execution, result: null, replayed: true };
    }

    const outcome = await executeProviderAttempt({
      execution,
      integration,
      adapter,
      executionRepository: this.executionRepository,
      clock: this.clock
    });

    return { ...outcome, replayed: false };
  }
}
