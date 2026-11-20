import { ExecutionStatus } from '../../domain/entities/Execution.js';

const DEFAULT_STALE_AFTER_MS = 300_000;
const DEFAULT_LEASE_MS = 180_000;

export class RecoverStaleExecutions {
  constructor({ executionRepository, clock, staleAfterMs = DEFAULT_STALE_AFTER_MS, leaseMs = DEFAULT_LEASE_MS }) {
    this.executionRepository = executionRepository;
    this.clock = clock;
    this.staleAfterMs = staleAfterMs;
    this.leaseMs = leaseMs;
  }

  async execute({ limit = 50 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new RangeError('limit deve ser um inteiro entre 1 e 100.');
    }
    if (typeof this.executionRepository.claimStaleExecutions !== 'function') {
      return { recovered: 0, skipped: 0, total: 0, results: [] };
    }

    const now = this.clock.now();
    const cutoff = new Date(now.getTime() - this.staleAfterMs);
    const stale = await this.executionRepository.claimStaleExecutions(cutoff, now, limit, this.leaseMs);
    const results = [];

    for (const execution of stale) {
      if (![ExecutionStatus.PENDING, ExecutionStatus.RUNNING].includes(execution.status)) {
        results.push({ executionId: execution.id, outcome: 'skipped', reason: 'state_changed' });
        continue;
      }
      const previousStatus = execution.status;
      try {
        execution.interrupt(this.clock.now());
        await this.executionRepository.save(execution);
        results.push({ executionId: execution.id, previousStatus, outcome: 'interrupted' });
      } catch (error) {
        if (error?.code === 'EXECUTION_LEASE_LOST') {
          results.push({ executionId: execution.id, outcome: 'skipped', reason: 'lease_lost' });
          continue;
        }
        throw error;
      }
    }

    return {
      queriedAt: now,
      total: stale.length,
      recovered: results.filter((item) => item.outcome === 'interrupted').length,
      skipped: results.filter((item) => item.outcome === 'skipped').length,
      results
    };
  }
}
