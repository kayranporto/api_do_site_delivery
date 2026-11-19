import { NotFoundError } from '../errors/NotFoundError.js';

export class DeactivateIntegration {
  constructor({ integrationRepository, clock }) {
    this.integrationRepository = integrationRepository;
    this.clock = clock;
  }

  async execute({ integrationId }) {
    const integration = await this.integrationRepository.findById(integrationId);
    if (!integration) throw new NotFoundError('Integração', integrationId);
    integration.deactivate(this.clock.now());
    await this.integrationRepository.save(integration);
    return integration;
  }
}
