import { NotFoundError } from '../errors/NotFoundError.js';

export class GetExecutionEvents {
  constructor({ executionRepository, eventRepository }) {
    this.executionRepository = executionRepository;
    this.eventRepository = eventRepository;
  }

  async execute({ executionId, limit = 100 }) {
    const execution = await this.executionRepository.findById(executionId);
    if (!execution) throw new NotFoundError('Execução', executionId);
    return this.eventRepository.findByExecutionId(executionId, limit);
  }
}
