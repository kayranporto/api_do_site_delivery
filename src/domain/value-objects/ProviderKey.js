import { ValidationError } from '../errors/ValidationError.js';

export class ProviderKey {
  #value;

  constructor(value) {
    if (typeof value !== 'string') {
      throw new ValidationError('ProviderKey deve ser um texto.');
    }

    const normalized = value.trim().toLowerCase();
    if (!/^[a-z][a-z0-9-]{1,62}$/.test(normalized)) {
      throw new ValidationError('ProviderKey deve começar com uma letra e conter apenas letras, números ou hífens.');
    }

    this.#value = normalized;
    Object.freeze(this);
  }

  get value() {
    return this.#value;
  }

  equals(other) {
    return other instanceof ProviderKey && other.value === this.#value;
  }

  toString() {
    return this.#value;
  }

  toJSON() {
    return this.#value;
  }
}
