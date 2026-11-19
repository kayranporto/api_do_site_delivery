import { NotFoundError } from '../errors/NotFoundError.js';

export class GetIntegration {
  constructor({ integrationRepository }) {
    this.integrationRepository = integrationRepository;
  }

  async execute({ integrationId }) {
    const integration = await this.integrationRepository.findById(integrationId);
    if (!integration) throw new NotFoundError('Integração', integrationId);
    return integration;
  }
}
