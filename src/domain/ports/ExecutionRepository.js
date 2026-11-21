/** Porta de saída: a implementação concreta ficará na camada de infraestrutura. */
export class ExecutionRepository {
  async save(_execution) {
    throw new Error('ExecutionRepository.save deve ser implementado por um adaptador.');
  }

  async createIfAbsent(_execution) {
    throw new Error('ExecutionRepository.createIfAbsent deve ser implementado por um adaptador.');
  }

  async findById(_executionId) {
    throw new Error('ExecutionRepository.findById deve ser implementado por um adaptador.');
  }

  async findByIdempotencyKey(_integrationId, _idempotencyKey) {
    throw new Error('ExecutionRepository.findByIdempotencyKey deve ser implementado por um adaptador.');
  }

  async findDueForRetry(_now, _limit) {
    throw new Error('ExecutionRepository.findDueForRetry deve ser implementado por um adaptador.');
  }

  async acquireLease(_execution, _leaseMs) {
    throw new Error('ExecutionRepository.acquireLease deve ser implementado por um adaptador.');
  }

  async renewLease(_execution, _leaseMs) {
    throw new Error('ExecutionRepository.renewLease deve ser implementado por um adaptador.');
  }

  async countByStatus() {
    throw new Error('ExecutionRepository.countByStatus deve ser implementado por um adaptador.');
  }

  async claimDueForRetry(_now, _limit, _leaseMs) {
    throw new Error('ExecutionRepository.claimDueForRetry deve ser implementado por um adaptador.');
  }

  async claimStaleExecutions(_cutoff, _now, _limit, _leaseMs) {
    throw new Error('ExecutionRepository.claimStaleExecutions deve ser implementado por um adaptador.');
  }
}
