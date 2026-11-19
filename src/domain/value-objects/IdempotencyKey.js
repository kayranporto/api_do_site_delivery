import { ValidationError } from '../errors/ValidationError.js';

export class IdempotencyKey {
  #value;

  constructor(value) {
    if (typeof value !== 'string') {
      throw new ValidationError('IdempotencyKey deve ser um texto.');
    }

    const normalized = value.trim();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,127}$/.test(normalized)) {
      throw new ValidationError('IdempotencyKey deve conter entre 8 e 128 caracteres válidos.');
    }

    this.#value = normalized;
    Object.freeze(this);
  }

  get value() {
    return this.#value;
  }

  equals(other) {
    return other instanceof IdempotencyKey && other.value === this.#value;
  }

  toString() {
    return this.#value;
  }

  toJSON() {
    return this.#value;
  }
}
