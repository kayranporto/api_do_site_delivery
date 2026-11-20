import { ExecutionStatus } from '../../domain/entities/Execution.js';
import { InvalidProviderAdapterError } from '../errors/InvalidProviderAdapterError.js';
import { executeProviderAttempt } from '../services/executeProviderAttempt.js';

const DEFAULT_LEASE_MS = 180_000;

export class RetryDueExecutions {
  constructor({ integrationRepository, executionRepository, providerRegistry, clock, leaseMs = DEFAULT_LEASE_MS }) {
    this.integrationRepository = integrationRepository;
    this.executionRepository = executionRepository;
    this.providerRegistry = providerRegistry;
    this.clock = clock;
    this.leaseMs = leaseMs;
  }

  async execute({ limit = 20 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new RangeError('limit deve ser um inteiro entre 1 e 100.');
    }

    const queriedAt = this.clock.now();
    const dueExecutions = typeof this.executionRepository.claimDueForRetry === 'function'
      ? await this.executionRepository.claimDueForRetry(queriedAt, limit, this.leaseMs)
      : await this.executionRepository.findDueForRetry(queriedAt, limit);
    const results = [];

    for (const execution of dueExecutions) {
      const now = this.clock.now();
      if (execution.status !== ExecutionStatus.RETRY_SCHEDULED
        || !execution.nextAttemptAt
        || execution.nextAttemptAt > now) {
        results.push({ execution, outcome: 'skipped', reason: 'retry_not_due' });
        continue;
      }

      const integration = await this.integrationRepository.findById(execution.integrationId);
      if (!integration) {
        execution.cancel(now);
        await this.executionRepository.save(execution);
        results.push({ execution, outcome: 'cancelled', reason: 'integration_not_found' });
        continue;
      }

      if (!integration.isActive) {
        execution.cancel(now);
        await this.executionRepository.save(execution);
        results.push({ execution, outcome: 'cancelled', reason: 'integration_inactive' });
        continue;
      }

      const providerKey = integration.providerKey.value;
      const adapter = await this.providerRegistry.resolve(providerKey);
      if (!adapter || typeof adapter.execute !== 'function') {
        throw new InvalidProviderAdapterError(providerKey);
      }

      const outcome = await executeProviderAttempt({
        execution,
        integration,
        adapter,
        executionRepository: this.executionRepository,
        clock: this.clock
      });
      results.push({ ...outcome, outcome: 'attempted' });
    }

    return {
      queriedAt,
      total: dueExecutions.length,
      processed: results.filter((item) => item.outcome === 'attempted').length,
      results
    };
  }
}
