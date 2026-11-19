import { describe, expect, test } from '@jest/globals';
import { Integration } from '../../../../src/domain/entities/Integration.js';
import { IntegrationInactiveError } from '../../../../src/domain/errors/IntegrationInactiveError.js';
import { ValidationError } from '../../../../src/domain/errors/ValidationError.js';

function makeIntegration(overrides = {}) {
  return new Integration({
    id: 'integration-01',
    name: 'CRM externo',
    providerKey: 'crm-provider',
    configurationReference: 'config:crm:production',
    secretReference: 'vault:crm:api-key',
    createdAt: new Date('2026-01-01T10:00:00.000Z'),
    ...overrides
  });
}

describe('Integration', () => {
  test('começa inativa e bloqueia a execução até ser ativada', () => {
    const integration = makeIntegration();
    expect(integration.status).toBe('inactive');
    expect(() => integration.assertCanExecute()).toThrow(IntegrationInactiveError);

    integration.activate(new Date('2026-01-01T10:01:00.000Z'));
    expect(integration.isActive).toBe(true);
    expect(() => integration.assertCanExecute()).not.toThrow();
  });

  test('permite desativar uma integração', () => {
    const integration = makeIntegration({ status: 'active' });
    integration.deactivate(new Date('2026-01-01T10:02:00.000Z'));
    expect(integration.status).toBe('inactive');
  });

  test('não aceita timeout fora dos limites', () => {
    expect(() => makeIntegration({ timeoutMs: 50 })).toThrow(ValidationError);
    expect(() => makeIntegration({ timeoutMs: 120_001 })).toThrow(ValidationError);
  });

  test('armazena apenas referências para configuração e segredo', () => {
    const integration = makeIntegration();
    const serialized = integration.toJSON();
    expect(serialized.configurationReference).toBe('config:crm:production');
    expect(serialized.secretReference).toBe('vault:crm:api-key');
    expect(serialized).not.toHaveProperty('apiKey');
    expect(serialized).not.toHaveProperty('secret');
  });

  test('não permite que updatedAt retroceda', () => {
    const integration = makeIntegration();
    expect(() => integration.rename('CRM v2', new Date('2025-12-31T23:59:59.000Z'))).toThrow(ValidationError);
  });
});
