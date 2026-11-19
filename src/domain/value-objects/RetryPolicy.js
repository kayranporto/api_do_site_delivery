import { ValidationError } from '../errors/ValidationError.js';

const MAX_ATTEMPTS_LIMIT = 10;
const MAX_DELAY_LIMIT_MS = 24 * 60 * 60 * 1000;

export class RetryPolicy {
  #maxAttempts;
  #initialDelayMs;
  #maxDelayMs;
  #backoffMultiplier;

  constructor({ maxAttempts = 3, initialDelayMs = 1_000, maxDelayMs = 30_000, backoffMultiplier = 2 } = {}) {
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > MAX_ATTEMPTS_LIMIT) {
      throw new ValidationError(`maxAttempts deve ser um inteiro entre 1 e ${MAX_ATTEMPTS_LIMIT}.`);
    }
    if (!Number.isInteger(initialDelayMs) || initialDelayMs < 0 || initialDelayMs > MAX_DELAY_LIMIT_MS) {
      throw new ValidationError('initialDelayMs deve ser um inteiro não negativo de até 24 horas.');
    }
    if (!Number.isInteger(maxDelayMs) || maxDelayMs < initialDelayMs || maxDelayMs > MAX_DELAY_LIMIT_MS) {
      throw new ValidationError('maxDelayMs deve ser maior ou igual ao atraso inicial e não exceder 24 horas.');
    }
    if (typeof backoffMultiplier !== 'number' || !Number.isFinite(backoffMultiplier) || backoffMultiplier < 1 || backoffMultiplier > 10) {
      throw new ValidationError('backoffMultiplier deve ser um número entre 1 e 10.');
    }

    this.#maxAttempts = maxAttempts;
    this.#initialDelayMs = initialDelayMs;
    this.#maxDelayMs = maxDelayMs;
    this.#backoffMultiplier = backoffMultiplier;
    Object.freeze(this);
  }

  get maxAttempts() {
    return this.#maxAttempts;
  }

  get initialDelayMs() {
    return this.#initialDelayMs;
  }

  get maxDelayMs() {
    return this.#maxDelayMs;
  }

  get backoffMultiplier() {
    return this.#backoffMultiplier;
  }

  canRetryAfter(attemptNumber) {
    return Number.isInteger(attemptNumber) && attemptNumber >= 1 && attemptNumber < this.#maxAttempts;
  }

  delayForAttempt(attemptNumber) {
    if (!Number.isInteger(attemptNumber) || attemptNumber < 1) {
      throw new ValidationError('attemptNumber deve ser um inteiro maior ou igual a 1.');
    }

    const delay = this.#initialDelayMs * (this.#backoffMultiplier ** (attemptNumber - 1));
    return Math.min(Math.round(delay), this.#maxDelayMs);
  }

  equals(other) {
    return other instanceof RetryPolicy
      && other.maxAttempts === this.#maxAttempts
      && other.initialDelayMs === this.#initialDelayMs
      && other.maxDelayMs === this.#maxDelayMs
      && other.backoffMultiplier === this.#backoffMultiplier;
  }

  toJSON() {
    return {
      maxAttempts: this.#maxAttempts,
      initialDelayMs: this.#initialDelayMs,
      maxDelayMs: this.#maxDelayMs,
      backoffMultiplier: this.#backoffMultiplier
    };
  }
}
