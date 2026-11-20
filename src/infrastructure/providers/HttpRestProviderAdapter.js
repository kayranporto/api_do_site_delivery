import { isIP } from 'node:net';
import { ProviderExecutionError } from '../../application/errors/ProviderExecutionError.js';

const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const BLOCKED_HEADERS = new Set([
  'host', 'content-length', 'connection', 'transfer-encoding', 'cookie',
  'proxy-authorization', 'proxy-connection'
]);
const SAFE_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']);

function providerFailure(code, retryable = false) {
  return new ProviderExecutionError({ code, retryable });
}

function validateHeader(name, value) {
  if (typeof name !== 'string' || !HEADER_NAME.test(name) || BLOCKED_HEADERS.has(name.toLowerCase())) {
    throw new TypeError('Nome de header não permitido na configuração do provedor.');
  }
  if (typeof value !== 'string' || /[\r\n]/.test(value)) {
    throw new TypeError('Valor de header inválido.');
  }
}

function safeBaseUrl(configuration) {
  if (typeof configuration.baseUrl !== 'string') throw new TypeError('baseUrl é obrigatória.');
  const url = new URL(configuration.baseUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new TypeError('O provedor deve usar uma URL HTTPS sem credenciais, query ou fragmento.');
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (isIP(hostname) !== 0) {
    throw new TypeError('Endereços IP literais não são permitidos; use um hostname aprovado.');
  }
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new TypeError('Host local não é permitido para provedores externos.');
  }
  if (!Array.isArray(configuration.allowedHosts)
    || !configuration.allowedHosts.includes(url.hostname.toLowerCase())) {
    throw new TypeError('O hostname base precisa estar explicitamente em allowedHosts.');
  }
  return url;
}

function operationUrl(baseUrl, path) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.includes('\\')) {
    throw new TypeError('O caminho da operação deve ser relativo à origem e começar com uma única barra.');
  }
  const url = new URL(path, baseUrl);
  if (url.origin !== baseUrl.origin || url.username || url.password || url.hash) {
    throw new TypeError('O caminho da operação tentou sair da origem configurada.');
  }
  return url;
}

async function readBodyLimited(response, maxBytes) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new TypeError('Resposta do provedor excedeu o limite configurado.');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks).toString('utf8');
}

function parseResponse(text, contentType) {
  if (!text) return null;
  if (contentType?.toLowerCase().includes('application/json')) {
    try { return JSON.parse(text); }
    catch { throw providerFailure('PROVIDER_INVALID_JSON_RESPONSE', false); }
  }
  return text;
}

/** Adaptador REST genérico. Operações e hosts vêm de configuração confiável, nunca do payload HTTP. */
export class HttpRestProviderAdapter {
  #configurationResolver;
  #secretResolver;
  #fetch;
  #maxRequestBytes;
  #maxResponseBytes;

  constructor({ configurationResolver, secretResolver, fetchImpl = globalThis.fetch, maxRequestBytes = 1_048_576, maxResponseBytes = 1_048_576 }) {
    if (!configurationResolver || typeof configurationResolver.resolve !== 'function') {
      throw new TypeError('configurationResolver.resolve é obrigatório.');
    }
    if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl é obrigatório.');
    if (!Number.isInteger(maxRequestBytes) || maxRequestBytes < 1) throw new TypeError('maxRequestBytes inválido.');
    if (!Number.isInteger(maxResponseBytes) || maxResponseBytes < 1) throw new TypeError('maxResponseBytes inválido.');

    this.#configurationResolver = configurationResolver;
    this.#secretResolver = secretResolver;
    this.#fetch = fetchImpl;
    this.#maxRequestBytes = maxRequestBytes;
    this.#maxResponseBytes = maxResponseBytes;
  }

  async execute(command) {
    const configuration = await this.#configurationResolver.resolve(command.integration.configurationReference);
    const baseUrl = safeBaseUrl(configuration);
    const definition = configuration.operations?.[command.operationName];
    if (!definition) throw providerFailure('PROVIDER_OPERATION_NOT_CONFIGURED', false);

    const method = String(definition.method ?? 'POST').toUpperCase();
    if (!SAFE_METHODS.has(method)) throw new TypeError('Método HTTP não permitido na configuração.');
    const url = operationUrl(baseUrl, definition.path);
    const headers = new Headers({ accept: 'application/json' });

    for (const [name, value] of Object.entries(configuration.headers ?? {})) {
      validateHeader(name, value);
      headers.set(name, value);
    }
    for (const [name, value] of Object.entries(definition.headers ?? {})) {
      validateHeader(name, value);
      headers.set(name, value);
    }

    const authentication = configuration.authentication;
    if (authentication) {
      if (!this.#secretResolver || typeof this.#secretResolver.resolve !== 'function') {
        throw new TypeError('secretResolver.resolve é obrigatório para este provedor.');
      }
      const secretReference = command.integration.secretReference;
      if (!secretReference) throw new TypeError('A integração não possui referência de segredo.');
      const secret = await this.#secretResolver.resolve(secretReference);
      if (typeof secret !== 'string' || !secret) throw new TypeError('O secret resolver retornou um valor inválido.');

      if (authentication.type === 'bearer') {
        headers.set('authorization', `Bearer ${secret}`);
      } else if (authentication.type === 'header') {
        const headerName = authentication.headerName;
        validateHeader(headerName, secret);
        const prefix = authentication.prefix ?? '';
        if (typeof prefix !== 'string' || /[\r\n]/.test(prefix)) throw new TypeError('Prefixo de autenticação inválido.');
        headers.set(headerName, `${prefix}${secret}`);
      } else {
        throw new TypeError('Tipo de autenticação não suportado.');
      }
    }

    const hasBody = !['GET', 'HEAD'].includes(method) && command.input != null;
    const body = hasBody ? JSON.stringify(command.input) : undefined;
    if (body && Buffer.byteLength(body, 'utf8') > this.#maxRequestBytes) {
      throw providerFailure('PROVIDER_REQUEST_TOO_LARGE', false);
    }
    if (body) headers.set('content-type', 'application/json');

    let response;
    try {
      response = await this.#fetch(url, {
        method,
        headers,
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(command.timeoutMs)
      });
    } catch (error) {
      const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
      throw providerFailure(timeout ? 'PROVIDER_TIMEOUT' : 'PROVIDER_NETWORK_ERROR', true);
    }

    if (response.status >= 300 && response.status < 400) {
      throw providerFailure('PROVIDER_REDIRECT_BLOCKED', false);
    }
    if (!response.ok) {
      const retryable = response.status === 408 || response.status === 425
        || response.status === 429 || response.status >= 500;
      throw providerFailure(`PROVIDER_HTTP_${response.status}`, retryable);
    }

    let responseText;
    try {
      responseText = await readBodyLimited(response, this.#maxResponseBytes);
    } catch {
      throw providerFailure('PROVIDER_RESPONSE_TOO_LARGE', false);
    }
    return parseResponse(responseText, response.headers.get('content-type'));
  }
}
