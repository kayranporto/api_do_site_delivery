/** Rate limiter local. Use gateway ou armazenamento distribuído em múltiplas réplicas. */
export function createRateLimiter({
  windowMs = 60_000,
  maxRequests = 120,
  maxClients = 10_000,
  clock = Date.now,
  keyResolver = (req) => typeof req.ip === 'string' && req.ip ? req.ip : 'unknown',
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
  if (typeof keyResolver !== 'function' || typeof skip !== 'function') {
    throw new TypeError('keyResolver e skip devem ser funções.');
  }

  const buckets = new Map();
  return function rateLimit(req, res, next) {
    try {
      if (skip(req)) return next();
      const now = clock();
      const key = keyResolver(req);
      if (typeof key !== 'string' || !key) throw new TypeError('Chave de rate limit inválida.');
      const currentWindowMs = resolveValue(windowMs, req, 'RATE_LIMIT_WINDOW_MS', 1_000, 3_600_000);
      const currentMax = resolveValue(maxRequests, req, 'RATE_LIMIT_MAX', 1, 100_000);
      let bucket = buckets.get(key);

      if (!bucket || now >= bucket.resetAt) {
        if (buckets.size >= maxClients) {
          for (const [client, entry] of buckets) {
            if (now >= entry.resetAt) buckets.delete(client);
          }
        }
        if (buckets.size >= maxClients && !buckets.has(key)) {
          res.setHeader('retry-after', '1');
          return res.status(503).json({
            error: { code: 'RATE_LIMIT_CAPACITY', message: 'Limite temporário de clientes atingido.' }
          });
        }
        bucket = { count: 0, resetAt: now + currentWindowMs };
        buckets.set(key, bucket);
      }

      bucket.count += 1;
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
