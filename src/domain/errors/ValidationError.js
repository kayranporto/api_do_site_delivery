import { DomainError } from './DomainError.js';

export class ValidationError extends DomainError {
  constructor(message, options = {}) {
    super(message, { code: 'VALIDATION_ERROR', ...options });
  }
}
