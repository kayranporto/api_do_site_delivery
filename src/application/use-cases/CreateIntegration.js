import { Integration } from '../../domain/entities/Integration.js';
import { RetryPolicy } from '../../domain/value-objects/RetryPolicy.js';

export class CreateIntegration {
  constructor({ integrationRepository, idGenerator, clock }) {
    this.integrationRepository = integrationRepository;
    this.idGenerator = idGenerator;
    this.clock = clock;
  }

  async execute(input) {
    const now = this.clock.now();
    const integration = new Integration({
      id: this.idGenerator.generate(),
      name: input.name,
      providerKey: input.providerKey,
      configurationReference: input.configurationReference,
      secretReference: input.secretReference ?? null,
      timeoutMs: input.timeoutMs ?? 10_000,
      retryPolicy: input.retryPolicy instanceof RetryPolicy
        ? input.retryPolicy
        : new RetryPolicy(input.retryPolicy),
      createdAt: now,
      updatedAt: now
    });

    await this.integrationRepository.save(integration);
    return integration;
  }
}
