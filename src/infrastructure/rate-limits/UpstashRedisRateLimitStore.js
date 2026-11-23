import { createHash } from 'node:crypto';

const DAY_MS = 24 * 60 * 60 * 1000;
const USAGE_RETENTION_DAYS = 35;
const USAGE_RETENTION_SECONDS = USAGE_RETENTION_DAYS * 24 * 60 * 60;

const CONSUME_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
if ARGV[2] == '1' then
  local daily = redis.call('INCR', KEYS[2])
  if daily == 1 then
    redis.call('EXPIRE', KEYS[2], ARGV[3])
  end
end
return { count, ttl }
`;

function digest(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function dateKey(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

/** Adapter Redis compartilhado usando a API REST do Upstash e comandos Lua atômicos. */
export class UpstashRedisRateLimitStore {
  constructor({ url, token, fetchImpl = globalThis.fetch, namespace = 'generic-integration-api' } = {}) {
    let parsed;
    try { parsed = new URL(url); } catch { throw new Error('UPSTASH_REDIS_REST_URL deve ser uma URL HTTPS válida.'); }
    if (!['https:', 'http:'].includes(parsed.protocol) || !parsed.hostname
      || parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new Error('UPSTASH_REDIS_REST_URL deve ser uma URL HTTP(S) sem credenciais ou parâmetros.');
    }
    if (typeof token !== 'string' || token.trim().length < 16) {
      throw new Error('UPSTASH_REDIS_REST_TOKEN é obrigatório.');
    }
    if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl deve ser uma função.');
    if (typeof namespace !== 'string' || !/^[a-zA-Z0-9:_-]{1,80}$/.test(namespace)) {
      throw new TypeError('namespace contém caracteres inválidos.');
    }

    this.url = parsed.toString().replace(/\/$/, '');
    this.token = token;
    this.fetchImpl = fetchImpl;
    this.namespace = namespace;
  }

  async ping() {
    const result = await this.command(['PING']);
    if (result !== 'PONG') throw new Error('O Redis compartilhado não confirmou o PING.');
    return true;
  }

  async ping() {
    const result = await this.command(['PING']);
    if (result !== 'PONG') throw new Error('O Redis compartilhado não confirmou o PING.');
    return true;
  }

  async consume({ key, windowMs, now = Date.now(), usageClientId = null }) {
    if (typeof key !== 'string' || !key) throw new TypeError('Chave de rate limit inválida.');
    if (!Number.isInteger(windowMs) || windowMs < 1_000 || windowMs > 3_600_000) {
      throw new RangeError('windowMs deve estar entre 1000 e 3600000.');
    }
    if (!Number.isFinite(now)) throw new TypeError('now deve ser um timestamp válido.');
    if (usageClientId !== null && (typeof usageClientId !== 'string' || !usageClientId)) {
      throw new TypeError('usageClientId deve ser uma string não vazia.');
    }

    const keyDigest = digest(key);
    const hashTag = '{' + keyDigest + '}';
    const rateKey = this.namespace + ':' + hashTag + ':rate';
    const trackUsage = Boolean(usageClientId);
    const usageKey = trackUsage
      ? this.namespace + ':' + hashTag + ':usage:' + dateKey(now)
      : this.namespace + ':' + hashTag + ':unused';
    const result = await this.command([
      'EVAL',
      CONSUME_SCRIPT,
      '2',
      rateKey,
      usageKey,
      String(windowMs),
      trackUsage ? '1' : '0',
      String(USAGE_RETENTION_SECONDS)
    ]);

    if (!Array.isArray(result) || result.length < 2) {
      throw new Error('O Redis compartilhado retornou uma resposta inválida para o rate limit.');
    }
    const count = Number(result[0]);
    const ttlMs = Number(result[1]);
    if (!Number.isSafeInteger(count) || count < 1 || !Number.isFinite(ttlMs) || ttlMs < 0) {
      throw new Error('O Redis compartilhado retornou contadores inválidos.');
    }
    return { count, resetAt: now + ttlMs };
  }

  async getClientUsage({ clientId, days = 30, now = Date.now() }) {
    if (typeof clientId !== 'string' || !clientId) throw new TypeError('clientId é obrigatório.');
    if (!Number.isInteger(days) || days < 1 || days > 30) throw new RangeError('days deve estar entre 1 e 30.');

    const keyDigest = digest('client:' + clientId);
    const hashTag = '{' + keyDigest + '}';
    const keys = [];
    const dates = [];
    for (let offset = days - 1; offset >= 0; offset -= 1) {
      const date = dateKey(now - offset * DAY_MS);
      dates.push(date);
      keys.push(this.namespace + ':' + hashTag + ':usage:' + date);
    }

    const values = await this.command(['MGET', ...keys]);
    if (!Array.isArray(values) || values.length !== keys.length) {
      throw new Error('O Redis compartilhado retornou um histórico de consumo inválido.');
    }
    const daily = dates.map((date, index) => {
      const requests = values[index] == null ? 0 : Number(values[index]);
      if (!Number.isSafeInteger(requests) || requests < 0) {
        throw new Error('O Redis compartilhado retornou um total diário inválido.');
      }
      return { date, requests };
    });
    return {
      daily,
      totalRequests: daily.reduce((sum, item) => sum + item.requests, 0)
    };
  }

  async command(command) {
    let response;
    try {
      response = await this.fetchImpl(this.url, {
        method: 'POST',
        headers: {
          authorization: 'Bearer ' + this.token,
          'content-type': 'application/json'
        },
        body: JSON.stringify(command)
      });
    } catch (error) {
      throw new Error('Não foi possível alcançar o Redis compartilhado.', { cause: error });
    }

    let payload;
    try { payload = await response.json(); } catch (error) {
      throw new Error('O Redis compartilhado retornou uma resposta que não é JSON.', { cause: error });
    }
    if (!response.ok || payload?.error || !Object.hasOwn(payload ?? {}, 'result')) {
      throw new Error('O comando no Redis compartilhado falhou.');
    }
    return payload.result;
  }
}
