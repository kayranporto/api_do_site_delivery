export class ListActiveIntegrations {
  constructor({ integrationRepository }) {
    this.integrationRepository = integrationRepository;
  }

  async execute() {
    return this.integrationRepository.listActive();
  }
}
