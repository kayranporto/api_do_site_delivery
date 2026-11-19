import { ValidationError } from '../errors/ValidationError.js';
import { IntegrationInactiveError } from '../errors/IntegrationInactiveError.js';
import { requiredString } from '../value-objects/requiredString.js';
import { ProviderKey } from '../value-objects/ProviderKey.js';
import { ConfigurationReference } from '../value-objects/ConfigurationReference.js';
import { SecretReference } from '../value-objects/SecretReference.js';
import { RetryPolicy } from '../value-objects/RetryPolicy.js';

const INTEGRATION_STATUSES = new Set(['active', 'inactive']);

function asValueObject(value, Type, fieldName) {
  if (value instanceof Type) return value;
  try {
    return new Type(value);
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError(`${fieldName} inválido.`, { cause: error });
  }
}

export class Integration {
  #id;
  #name;
  #providerKey;
  #configurationReference;
  #secretReference;
  #status;
  #timeoutMs;
  #retryPolicy;
  #createdAt;
  #updatedAt;

  constructor({
    id,
    name,
    providerKey,
    configurationReference,
    secretReference = null,
    status = 'inactive',
    timeoutMs = 10_000,
    retryPolicy = new RetryPolicy(),
    createdAt = new Date(),
    updatedAt = createdAt
  }) {
    this.#id = requiredString(id, 'id', { min: 1, max: 80 });
    this.#name = requiredString(name, 'name', { min: 2, max: 120 });
    this.#providerKey = asValueObject(providerKey, ProviderKey, 'providerKey');
    this.#configurationReference = asValueObject(configurationReference, ConfigurationReference, 'configurationReference');
    this.#secretReference = secretReference == null
      ? null
      : asValueObject(secretReference, SecretReference, 'secretReference');

    if (!INTEGRATION_STATUSES.has(status)) {
      throw new ValidationError('status deve ser "active" ou "inactive".');
    }
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000) {
      throw new ValidationError('timeoutMs deve ser um inteiro entre 100 e 120000.');
    }

    this.#status = status;
    this.#timeoutMs = timeoutMs;
    this.#retryPolicy = retryPolicy instanceof RetryPolicy ? retryPolicy : new RetryPolicy(retryPolicy);
    this.#createdAt = this.#date(createdAt, 'createdAt');
    this.#updatedAt = this.#date(updatedAt, 'updatedAt');
    if (this.#updatedAt < this.#createdAt) {
      throw new ValidationError('updatedAt não pode ser anterior a createdAt.');
    }
  }

  #date(value, fieldName) {
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new ValidationError(`${fieldName} deve ser uma data válida.`);
    }
    return date;
  }

  #touch(at = new Date()) {
    const date = this.#date(at, 'updatedAt');
    if (date < this.#updatedAt) {
      throw new ValidationError('updatedAt não pode retroceder.');
    }
    this.#updatedAt = date;
  }

  get id() { return this.#id; }
  get name() { return this.#name; }
  get providerKey() { return this.#providerKey; }
  get configurationReference() { return this.#configurationReference; }
  get secretReference() { return this.#secretReference; }
  get status() { return this.#status; }
  get isActive() { return this.#status === 'active'; }
  get timeoutMs() { return this.#timeoutMs; }
  get retryPolicy() { return this.#retryPolicy; }
  get createdAt() { return new Date(this.#createdAt); }
  get updatedAt() { return new Date(this.#updatedAt); }

  activate(at = new Date()) {
    this.#touch(at);
    this.#status = 'active';
    return this;
  }

  deactivate(at = new Date()) {
    this.#touch(at);
    this.#status = 'inactive';
    return this;
  }

  assertCanExecute() {
    if (!this.isActive) throw new IntegrationInactiveError(this.#id);
  }

  rename(name, at = new Date()) {
    const normalized = requiredString(name, 'name', { min: 2, max: 120 });
    this.#touch(at);
    this.#name = normalized;
    return this;
  }

  updateConfigurationReference(reference, at = new Date()) {
    const value = asValueObject(reference, ConfigurationReference, 'configurationReference');
    this.#touch(at);
    this.#configurationReference = value;
    return this;
  }

  updateSecretReference(reference, at = new Date()) {
    const value = reference == null ? null : asValueObject(reference, SecretReference, 'secretReference');
    this.#touch(at);
    this.#secretReference = value;
    return this;
  }

  updateTimeout(timeoutMs, at = new Date()) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000) {
      throw new ValidationError('timeoutMs deve ser um inteiro entre 100 e 120000.');
    }
    this.#touch(at);
    this.#timeoutMs = timeoutMs;
    return this;
  }

  updateRetryPolicy(retryPolicy, at = new Date()) {
    const value = retryPolicy instanceof RetryPolicy ? retryPolicy : new RetryPolicy(retryPolicy);
    this.#touch(at);
    this.#retryPolicy = value;
    return this;
  }

  toJSON() {
    return {
      id: this.#id,
      name: this.#name,
      providerKey: this.#providerKey.toJSON(),
      configurationReference: this.#configurationReference.toJSON(),
      secretReference: this.#secretReference?.toJSON() ?? null,
      status: this.#status,
      timeoutMs: this.#timeoutMs,
      retryPolicy: this.#retryPolicy.toJSON(),
      createdAt: this.#createdAt.toISOString(),
      updatedAt: this.#updatedAt.toISOString()
    };
  }
}
