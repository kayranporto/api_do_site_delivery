import { BusinessRuleError } from './BusinessRuleError.js';

export class RetryLimitExceededError extends BusinessRuleError {
  constructor(maxAttempts) {
    super(`O limite de ${maxAttempts} tentativa(s) já foi atingido.`, {
      code: 'RETRY_LIMIT_EXCEEDED'
    });
    this.maxAttempts = maxAttempts;
  }
}
