import { ValidationError } from '../errors/ValidationError.js';

export function requiredString(value, fieldName, { min = 1, max = 255 } = {}) {
  if (typeof value !== 'string') {
    throw new ValidationError(`${fieldName} deve ser um texto.`);
  }

  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max) {
    throw new ValidationError(`${fieldName} deve conter entre ${min} e ${max} caracteres.`);
  }

  return normalized;
}
