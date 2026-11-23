import { createInMemoryRateLimitStore } from '../../rate-limits/InMemoryRateLimitStore.js';

/** Rate limiter com store substituível: memória local ou Redis compartilhado. */
export function createRateLimiter({
  windowMs = 60_000,
  maxRequests = 120,
  maxClients = 10_000,
  clock = Date.now,
  rateLimitStore = createInMemoryRateLimitStore({ maxClients }),
  keyResolver = (req) => typeof req.ip === 'string' && req.ip ? req.ip : 'unknown',
  usageClientIdResolver = () => null,
  skip = () => false
} = {}) {
  const resolveValue = (value, req, name, min, max) => {
    const resolved = typeof value === 'function' ? value(req) : value;
    if (!Number.isInteger(resolved) || resolved < min || resolved > max) {
      throw new RangeError(name + ' fora do intervalo permitido.');
    }
    return resolved;
  };
  if (typeof windowMs !== 'function') resolveValue(windowMs, {}, 'windowMs', 1_000, 3_600_000);
  if (typeof maxRequests !== 'function') resolveValue(maxRequests, {}, 'maxRequests', 1, 100_000);
  if (!Number.isInteger(maxClients) || maxClients < 100 || maxClients > 100_000) {
    throw new RangeError('maxClients deve estar entre 100 e 100000.');
  }
  if (typeof keyResolver !== 'function' || typeof usageClientIdResolver !== 'function' || typeof skip !== 'function') {
    throw new TypeError('keyResolver, usageClientIdResolver e skip devem ser funções.');
  }
  if (!rateLimitStore || typeof rateLimitStore.consume !== 'function') {
    throw new TypeError('rateLimitStore deve implementar consume().');
  }

  return async function rateLimit(req, res, next) {
    try {
      if (skip(req)) return next();
      const now = clock();
      const key = keyResolver(req);
      if (typeof key !== 'string' || !key) throw new TypeError('Chave de rate limit inválida.');
      const usageClientId = usageClientIdResolver(req);
      if (usageClientId !== null && usageClientId !== undefined
        && (typeof usageClientId !== 'string' || !usageClientId)) {
        throw new TypeError('Identificador de cliente para consumo inválido.');
      }
      const currentWindowMs = resolveValue(windowMs, req, 'RATE_LIMIT_WINDOW_MS', 1_000, 3_600_000);
      const currentMax = resolveValue(maxRequests, req, 'RATE_LIMIT_MAX', 1, 100_000);
      const bucket = await rateLimitStore.consume({
        key,
        windowMs: currentWindowMs,
        now,
        usageClientId: usageClientId ?? null
      });

      if (bucket.capacityExceeded) {
        res.setHeader('retry-after', '1');
        return res.status(503).json({
          error: { code: 'RATE_LIMIT_CAPACITY', message: 'Limite temporário de clientes atingido.' }
        });
      }

      const remaining = Math.max(0, currentMax - bucket.count);
      res.setHeader('x-ratelimit-limit', String(currentMax));
      res.setHeader('x-ratelimit-remaining', String(remaining));
      res.setHeader('x-ratelimit-reset', String(Math.ceil(bucket.resetAt / 1000)));

      if (bucket.count > currentMax) {
        res.setHeader('retry-after', String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
        return res.status(429).json({
          error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Muitas requisições. Tente novamente mais tarde.', requestId: req.requestId }
        });
      }
      return next();
    } catch (error) {
      return next(error);
    }
  };
}
