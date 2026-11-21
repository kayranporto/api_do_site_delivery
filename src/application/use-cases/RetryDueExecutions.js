import { ExecutionStatus } from '../../domain/entities/Execution.js';
import { InvalidProviderAdapterError } from '../errors/InvalidProviderAdapterError.js';
import { executeProviderAttempt } from '../services/executeProviderAttempt.js';
import { recordOperationalEvent } from '../services/recordOperationalEvent.js';

const DEFAULT_LEASE_MS = 180_000;

export class RetryDueExecutions {
  constructor({ integrationRepository, executionRepository, providerRegistry, clock, eventRepository, leaseMs = DEFAULT_LEASE_MS }) {
    this.integrationRepository = integrationRepository;
    this.executionRepository = executionRepository;
    this.providerRegistry = providerRegistry;
    this.clock = clock;
    this.eventRepository = eventRepository;
    this.leaseMs = leaseMs;
  }

  async execute({ limit = 20 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new RangeError('limit deve ser um inteiro entre 1 e 100.');
    }
    const queriedAt = this.clock.now();
    const due = typeof this.executionRepository.claimDueForRetry === 'function'
      ? await this.executionRepository.claimDueForRetry(queriedAt, limit, this.leaseMs)
      : await this.executionRepository.findDueForRetry(queriedAt, limit);
    const results = [];

    for (const execution of due) {
      try {
        const now = this.clock.now();
        if (execution.status !== ExecutionStatus.RETRY_SCHEDULED || !execution.nextAttemptAt || execution.nextAttemptAt > now) {
          results.push({ execution, outcome: 'skipped', reason: 'retry_not_due' });
          continue;
        }

        const integration = await this.integrationRepository.findById(execution.integrationId);
        if (!integration) {
          execution.cancel(now);
          await this.executionRepository.save(execution);
          await recordOperationalEvent({
            eventRepository: this.eventRepository,
            executionId: execution.id,
            integrationId: execution.integrationId,
            eventType: 'execution.retry_cancelled',
            severity: 'warning',
            details: { reason: 'integration_not_found', status: execution.status },
            createdAt: this.clock.now()
          });
          results.push({ execution, outcome: 'cancelled', reason: 'integration_not_found' });
          continue;
        }
        if (!integration.isActive) {
          execution.cancel(now);
          await this.executionRepository.save(execution);
          await recordOperationalEvent({
            eventRepository: this.eventRepository,
            executionId: execution.id,
            integrationId: integration.id,
            eventType: 'execution.retry_cancelled',
            severity: 'warning',
            details: { reason: 'integration_inactive', status: execution.status },
            createdAt: this.clock.now()
          });
          results.push({ execution, outcome: 'cancelled', reason: 'integration_inactive' });
          continue;
        }

        const adapter = await this.providerRegistry.resolve(integration.providerKey.value);
        if (!adapter || typeof adapter.execute !== 'function') {
          throw new InvalidProviderAdapterError(integration.providerKey.value);
        }
        const outcome = await executeProviderAttempt({
          execution, integration, adapter,
          executionRepository: this.executionRepository,
          eventRepository: this.eventRepository,
          clock: this.clock, leaseMs: this.leaseMs
        });
        results.push({ ...outcome, outcome: 'attempted' });
      } catch (error) {
        if (error?.code === 'EXECUTION_LEASE_LOST') {
          results.push({ execution, outcome: 'skipped', reason: 'lease_lost' });
          continue;
        }
        throw error;
      }
    }

    return {
      queriedAt,
      total: due.length,
      processed: results.filter((item) => item.outcome === 'attempted').length,
      results
    };
  }
}
