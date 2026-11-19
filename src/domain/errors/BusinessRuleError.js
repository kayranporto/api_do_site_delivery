import { DomainError } from './DomainError.js';

export class BusinessRuleError extends DomainError {
  constructor(message, options = {}) {
    super(message, { code: 'BUSINESS_RULE_VIOLATION', ...options });
  }
}
