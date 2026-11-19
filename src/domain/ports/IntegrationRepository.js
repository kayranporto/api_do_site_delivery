/** Porta de saída: a implementação concreta ficará na camada de infraestrutura. */
export class IntegrationRepository {
  async save(_integration) {
    throw new Error('IntegrationRepository.save deve ser implementado por um adaptador.');
  }

  async findById(_integrationId) {
    throw new Error('IntegrationRepository.findById deve ser implementado por um adaptador.');
  }

  async findByProviderKey(_providerKey) {
    throw new Error('IntegrationRepository.findByProviderKey deve ser implementado por um adaptador.');
  }

  async listActive() {
    throw new Error('IntegrationRepository.listActive deve ser implementado por um adaptador.');
  }
}
