export class GetOperationalMetrics {
  constructor({ executionRepository, eventRepository, clock }) {
    this.executionRepository = executionRepository;
    this.eventRepository = eventRepository;
    this.clock = clock;
  }

  async execute({ windowHours = 24 } = {}) {
    if (!Number.isInteger(windowHours) || windowHours < 1 || windowHours > 720) {
      throw new RangeError('windowHours deve ficar entre 1 e 720.');
    }
    const generatedAt = this.clock.now();
    const since = new Date(generatedAt.getTime() - windowHours * 60 * 60 * 1000);
    const [executionsByStatus, events] = await Promise.all([
      this.executionRepository.countByStatus(),
      this.eventRepository.countSince(since)
    ]);
    return { generatedAt, windowHours, executionsByStatus, events };
  }
}
