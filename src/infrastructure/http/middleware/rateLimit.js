/** Rate limiter em memória: adequado a instância única; use gateway/Redis em múltiplas réplicas. */
export function createRateLimiter({
  windowMs = 60_000,
  maxRequests = 120,
  maxClients = 10_000,
  clock = Date.now
} = {}) {
  if (!Number.isInteger(windowMs) || windowMs < 1_000 || windowMs > 3_600_000) {
    throw new RangeError('RATE_LIMIT_WINDOW_MS deve estar entre 1000 e 3600000.');
  }
  if (!Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > 100_000) {
    throw new RangeError('RATE_LIMIT_MAX deve estar entre 1 e 100000.');
  }
  if (!Number.isInteger(maxClients) || maxClients < 100 || maxClients > 100_000) {
    throw new RangeError('maxClients deve estar entre 100 e 100000.');
  }

  const buckets = new Map();
  return function rateLimit(req, res, next) {
    const now = clock();
    const key = typeof req.ip === 'string' && req.ip ? req.ip : 'unknown';
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
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;
    const remaining = Math.max(0, maxRequests - bucket.count);
    res.setHeader('x-ratelimit-limit', String(maxRequests));
    res.setHeader('x-ratelimit-remaining', String(remaining));
    res.setHeader('x-ratelimit-reset', String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > maxRequests) {
      res.setHeader('retry-after', String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
      return res.status(429).json({
        error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Muitas requisições. Tente novamente mais tarde.', requestId: req.requestId }
      });
    }
    return next();
  };
}
