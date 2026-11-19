import { BusinessRuleError } from './BusinessRuleError.js';

export class InvalidStateTransitionError extends BusinessRuleError {
  constructor(from, action) {
    super(`A ação "${action}" não é permitida quando o estado é "${from}".`, {
      code: 'INVALID_STATE_TRANSITION'
    });
    this.from = from;
    this.action = action;
  }
}
