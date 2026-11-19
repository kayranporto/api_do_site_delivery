import { ApplicationError } from './ApplicationError.js';

export class NotFoundError extends ApplicationError {
  constructor(resource, identifier) {
    super(`${resource} não encontrado.`, { code: 'RESOURCE_NOT_FOUND' });
    this.resource = resource;
    this.identifier = identifier;
  }
}
