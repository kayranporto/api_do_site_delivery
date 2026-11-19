import { ApplicationError } from './ApplicationError.js';

export class IdempotencyConflictError extends ApplicationError {
  constructor(integrationId) {
    super('A chave de idempotência já foi usada com uma operação ou payload diferente.', {
      code: 'IDEMPOTENCY_KEY_REUSED'
    });
    this.integrationId = integrationId;
  }
}
