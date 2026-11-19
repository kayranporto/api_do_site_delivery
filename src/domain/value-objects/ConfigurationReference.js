import { ValidationError } from '../errors/ValidationError.js';

export class ConfigurationReference {
  #value;

  constructor(value) {
    if (typeof value !== 'string') {
      throw new ValidationError('ConfigurationReference deve ser um identificador de configuração.');
    }

    const normalized = value.trim();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{2,127}$/.test(normalized)) {
      throw new ValidationError('ConfigurationReference inválida. Informe uma referência, não a configuração em si.');
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
