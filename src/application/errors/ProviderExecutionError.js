import { ApplicationError } from './ApplicationError.js';

const SAFE_ERROR_CODE = /^[A-Z][A-Z0-9_]{1,63}$/;

/** Erro seguro que um adaptador pode lançar para informar falha e se ela admite retry. */
export class ProviderExecutionError extends ApplicationError {
  constructor({ code = 'PROVIDER_EXECUTION_FAILED', retryable = false, cause } = {}) {
    if (typeof code !== 'string' || !SAFE_ERROR_CODE.test(code)) {
      throw new TypeError('ProviderExecutionError.code deve ser um código seguro em letras maiúsculas.');
    }
    if (typeof retryable !== 'boolean') {
      throw new TypeError('ProviderExecutionError.retryable deve ser booleano.');
    }
    super('A execução no provedor externo falhou.', { code, cause });
    this.retryable = retryable;
  }
}
