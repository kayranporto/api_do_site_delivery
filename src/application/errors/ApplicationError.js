export class ApplicationError extends Error {
  constructor(message, { code = 'APPLICATION_ERROR', cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = new.target.name;
    this.code = code;
    Error.captureStackTrace?.(this, new.target);
  }
}
