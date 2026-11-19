import { ValidationError } from '../errors/ValidationError.js';

export class OperationName {
  #value;

  constructor(value) {
    if (typeof value !== 'string') {
      throw new ValidationError('OperationName deve ser um texto.');
    }

    const normalized = value.trim().toLowerCase();
    if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(normalized) || normalized.length > 100) {
      throw new ValidationError('OperationName deve usar um identificador como "customer.create".');
    }

    this.#value = normalized;
    Object.freeze(this);
  }

  get value() {
    return this.#value;
  }

  equals(other) {
    return other instanceof OperationName && other.value === this.#value;
  }

  toString() {
    return this.#value;
  }

  toJSON() {
    return this.#value;
  }
}
