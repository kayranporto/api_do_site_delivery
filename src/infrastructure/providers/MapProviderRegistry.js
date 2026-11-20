import { ProviderNotFoundError } from '../../application/errors/ProviderNotFoundError.js';

export class MapProviderRegistry {
  #providers = new Map();

  constructor(providers = {}) {
    for (const [key, adapter] of Object.entries(providers)) this.register(key, adapter);
  }

  register(providerKey, adapter) {
    if (typeof providerKey !== 'string' || !/^[a-z][a-z0-9-]{1,62}$/.test(providerKey)) {
      throw new TypeError('providerKey inválida.');
    }
    if (!adapter || typeof adapter.execute !== 'function') {
      throw new TypeError('Adaptador deve implementar execute(command).');
    }
    if (this.#providers.has(providerKey)) throw new Error(`Provedor "${providerKey}" já registrado.`);
    this.#providers.set(providerKey, adapter);
    return this;
  }

  async resolve(providerKey) {
    const adapter = this.#providers.get(providerKey);
    if (!adapter) throw new ProviderNotFoundError(providerKey);
    return adapter;
  }
}
