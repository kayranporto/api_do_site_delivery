import { ApplicationError } from './ApplicationError.js';

export class InvalidProviderAdapterError extends ApplicationError {
  constructor(providerKey) {
    super(`O adaptador do provedor "${providerKey}" não implementa execute().`, {
      code: 'INVALID_PROVIDER_ADAPTER'
    });
    this.providerKey = providerKey;
  }
}
