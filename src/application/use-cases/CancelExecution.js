import { NotFoundError } from '../errors/NotFoundError.js';

export class CancelExecution {
  constructor({ executionRepository, clock }) {
    this.executionRepository = executionRepository;
    this.clock = clock;
  }

  async execute({ executionId }) {
    const execution = await this.executionRepository.findById(executionId);
    if (!execution) throw new NotFoundError('Execução', executionId);
    execution.cancel(this.clock.now());
    await this.executionRepository.save(execution);
    return execution;
  }
}
