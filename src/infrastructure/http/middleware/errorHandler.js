import { DomainError } from '../../../domain/errors/DomainError.js';
import { ApplicationError } from '../../../application/errors/ApplicationError.js';
import { NotFoundError } from '../../../application/errors/NotFoundError.js';
import { IdempotencyConflictError } from '../../../application/errors/IdempotencyConflictError.js';
import { ProviderNotFoundError } from '../../../application/errors/ProviderNotFoundError.js';
import { InvalidProviderAdapterError } from '../../../application/errors/InvalidProviderAdapterError.js';
import { ValidationError } from '../../../domain/errors/ValidationError.js';
import { BusinessRuleError } from '../../../domain/errors/BusinessRuleError.js';

function classifyError(error) {
  if (error instanceof NotFoundError) return { status: 404, code: error.code, message: error.message };
  if (error instanceof IdempotencyConflictError) return { status: 409, code: error.code, message: error.message };
  if (error instanceof ProviderNotFoundError) return { status: 503, code: error.code, message: 'O provedor solicitado não está disponível.' };
  if (error instanceof InvalidProviderAdapterError) return { status: 500, code: error.code, message: 'A configuração interna do provedor é inválida.' };
  if (error instanceof ValidationError) return { status: 400, code: error.code, message: error.message };
  if (error instanceof BusinessRuleError) return { status: 409, code: error.code, message: error.message };
  if (error instanceof DomainError || error instanceof ApplicationError) {
    return { status: 400, code: error.code, message: error.message };
  }
  if (error?.type === 'entity.too.large') {
    return { status: 413, code: 'PAYLOAD_TOO_LARGE', message: 'O corpo da requisição excede o limite permitido.' };
  }
  if (error?.type === 'entity.parse.failed' || error instanceof SyntaxError) {
    return { status: 400, code: 'INVALID_JSON', message: 'O corpo da requisição não contém JSON válido.' };
  }
  return { status: 500, code: 'INTERNAL_ERROR', message: 'Ocorreu um erro interno.' };
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  const classified = classifyError(error);
  if (classified.status >= 500) {
    // Não registrar body, headers de autenticação ou mensagens de provedores.
    req.log?.error?.({ requestId: req.requestId, code: classified.code }, 'HTTP request failed');
  }
  return res.status(classified.status).json({
    error: {
      code: classified.code,
      message: classified.message,
      requestId: req.requestId
    }
  });
}
