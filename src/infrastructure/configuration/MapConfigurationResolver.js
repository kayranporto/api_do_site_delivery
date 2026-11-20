export class ConfigurationNotFoundError extends Error {
  constructor(reference) {
    super('Configuração externa não encontrada.');
    this.name = 'ConfigurationNotFoundError';
    this.code = 'CONFIGURATION_NOT_FOUND';
    this.reference = reference;
  }
}

/** Resolve referências para configurações fornecidas pelo composition root. */
export class MapConfigurationResolver {
  #configurations;

  constructor(configurations = {}) {
    this.#configurations = new Map(Object.entries(configurations));
  }

  async resolve(reference) {
    const key = typeof reference === 'string' ? reference : reference?.value;
    if (!key || !this.#configurations.has(key)) {
      throw new ConfigurationNotFoundError(key ?? 'unknown');
    }
    return structuredClone(this.#configurations.get(key));
  }
}
