import { describe, expect, test } from '@jest/globals';
import { ProviderKey } from '../../../../src/domain/value-objects/ProviderKey.js';
import { ValidationError } from '../../../../src/domain/errors/ValidationError.js';

describe('ProviderKey', () => {
  test('normaliza o identificador do provedor', () => {
    expect(new ProviderKey('  Example-Service ').value).toBe('example-service');
  });

  test('rejeita identificadores fora do formato', () => {
    expect(() => new ProviderKey('1provider')).toThrow(ValidationError);
    expect(() => new ProviderKey('provider name')).toThrow(ValidationError);
  });
});
