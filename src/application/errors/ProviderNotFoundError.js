import { ApplicationError } from './ApplicationError.js';

export class ProviderNotFoundError extends ApplicationError {
  constructor(providerKey) {
    super(`Nenhum adaptador está registrado para o provedor "${providerKey}".`, {
      code: 'PROVIDER_NOT_REGISTERED'
    });
    this.providerKey = providerKey;
  }
}
