import { IntegrationRepository } from '../../domain/ports/IntegrationRepository.js';
import { Integration } from '../../domain/entities/Integration.js';

function reconstitute(record) {
  return new Integration({
    ...record,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt)
  });
}

/** Adaptador volátil para testes e desenvolvimento local. Não usar como persistência de produção. */
export class InMemoryIntegrationRepository extends IntegrationRepository {
  #records = new Map();

  async save(integration) {
    const record = structuredClone(integration.toJSON());
    this.#records.set(integration.id, record);
    return reconstitute(record);
  }

  async findById(integrationId) {
    const record = this.#records.get(integrationId);
    return record ? reconstitute(structuredClone(record)) : null;
  }

  async findByProviderKey(providerKey) {
    const key = typeof providerKey === 'string' ? providerKey : providerKey.value;
    return [...this.#records.values()]
      .filter((record) => record.providerKey === key)
      .map((record) => reconstitute(structuredClone(record)));
  }

  async listActive() {
    return [...this.#records.values()]
      .filter((record) => record.status === 'active')
      .map((record) => reconstitute(structuredClone(record)));
  }
}
