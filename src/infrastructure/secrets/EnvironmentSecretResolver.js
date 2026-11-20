const ENV_REFERENCE = /^env:([A-Z][A-Z0-9_]*)$/;

export class SecretNotFoundError extends Error {
  constructor(reference) {
    super('Segredo referenciado não foi encontrado.');
    this.name = 'SecretNotFoundError';
    this.code = 'SECRET_NOT_FOUND';
    this.reference = reference;
  }
}

export class InvalidSecretReferenceError extends Error {
  constructor() {
    super('Referência de segredo deve usar o formato env:NOME_DA_VARIAVEL.');
    this.name = 'InvalidSecretReferenceError';
    this.code = 'INVALID_SECRET_REFERENCE';
  }
}

/** Adaptador simples para desenvolvimento. Produção deve usar um secret manager dedicado. */
export class EnvironmentSecretResolver {
  #environment;

  constructor(environment = process.env) {
    this.#environment = environment;
  }

  async resolve(reference) {
    const value = typeof reference === 'string' ? reference : reference?.value;
    const match = typeof value === 'string' ? ENV_REFERENCE.exec(value) : null;
    if (!match) throw new InvalidSecretReferenceError();

    const secret = this.#environment[match[1]];
    if (typeof secret !== 'string' || secret.length === 0) {
      throw new SecretNotFoundError(value);
    }
    return secret;
  }
}
