import { describe, expect, test } from '@jest/globals';
import { RetryPolicy } from '../../../../src/domain/value-objects/RetryPolicy.js';
import { ValidationError } from '../../../../src/domain/errors/ValidationError.js';

describe('RetryPolicy', () => {
  test('calcula atrasos exponenciais e respeita o limite máximo', () => {
    const policy = new RetryPolicy({
      maxAttempts: 5,
      initialDelayMs: 1_000,
      maxDelayMs: 3_000,
      backoffMultiplier: 2
    });

    expect(policy.delayForAttempt(1)).toBe(1_000);
    expect(policy.delayForAttempt(2)).toBe(2_000);
    expect(policy.delayForAttempt(3)).toBe(3_000);
    expect(policy.delayForAttempt(4)).toBe(3_000);
  });

  test('não permite novas tentativas depois do limite', () => {
    const policy = new RetryPolicy({ maxAttempts: 2 });
    expect(policy.canRetryAfter(1)).toBe(true);
    expect(policy.canRetryAfter(2)).toBe(false);
  });

  test('rejeita configuração inválida', () => {
    expect(() => new RetryPolicy({ maxAttempts: 0 })).toThrow(ValidationError);
    expect(() => new RetryPolicy({ maxAttempts: 11 })).toThrow(ValidationError);
  });
});
