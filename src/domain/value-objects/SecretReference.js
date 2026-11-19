import { ValidationError } from '../errors/ValidationError.js';

/** Identificador opaco de um segredo armazenado fora do domínio. */
export class SecretReference {
  #value;

  constructor(value) {
    if (typeof value !== 'string') {
      throw new ValidationError('SecretReference deve ser um identificador de segredo.');
    }

    const normalized = value.trim();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{2,127}$/.test(normalized)) {
      throw new ValidationError('SecretReference inválida. Nunca informe o token ou a chave secreta diretamente.');
    }

    this.#value = normalized;
    Object.freeze(this);
  }

  get value() {
    return this.#value;
  }

  toString() {
    return this.#value;
  }

  toJSON() {
    return this.#value;
  }
}
