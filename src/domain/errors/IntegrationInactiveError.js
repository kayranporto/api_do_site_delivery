import { BusinessRuleError } from './BusinessRuleError.js';

export class IntegrationInactiveError extends BusinessRuleError {
  constructor(integrationId) {
    super('Não é possível executar operações em uma integração inativa.', {
      code: 'INTEGRATION_INACTIVE'
    });
    this.integrationId = integrationId;
  }
}
