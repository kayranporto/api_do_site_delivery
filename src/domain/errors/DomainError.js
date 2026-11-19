export class DomainError extends Error {
  constructor(message, { code = 'DOMAIN_ERROR', cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = new.target.name;
    this.code = code;
    Error.captureStackTrace?.(this, new.target);
  }
}
