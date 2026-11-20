import { NotFoundError } from '../errors/NotFoundError.js';

export class GetExecution {
  constructor({ executionRepository }) {
    this.executionRepository = executionRepository;
  }

  async execute({ executionId }) {
    const execution = await this.executionRepository.findById(executionId);
    if (!execution) throw new NotFoundError('Execução', executionId);
    return execution;
  }
}
