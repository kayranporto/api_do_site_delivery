function parsePort(value) {
  const port = Number(value ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('PORT deve ser um número inteiro entre 1 e 65535.');
  return port;
}
function boundedInteger(value, fallback, min, max, name) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(name + ' deve ser um inteiro entre ' + min + ' e ' + max + '.');
  }
  return parsed;
}
function parsePoolMax(value) {
  return boundedInteger(value, 10, 1, 50, 'DATABASE_POOL_MAX');
}
function parseProviderConfigurations(value) {
  if (!value) return {};
  let parsed;
  try { parsed = JSON.parse(value); } catch { throw new Error('PROVIDER_CONFIG_JSON deve conter um objeto JSON válido.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('PROVIDER_CONFIG_JSON deve conter um objeto JSON.');
  return parsed;
}
function parseDatabaseUrl(value) {
  if (value == null || value.trim() === '') return null;
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error('DATABASE_URL deve ser uma URL PostgreSQL válida.'); }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname) {
    throw new Error('DATABASE_URL deve usar o protocolo postgres:// ou postgresql://.');
  }
  return value;
}
function parseUpstashUrl(value, nodeEnv) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('UPSTASH_REDIS_REST_URL é obrigatório quando RATE_LIMIT_STORE=upstash.');
  }
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error('UPSTASH_REDIS_REST_URL deve ser uma URL válida.'); }
  if (!['https:', 'http:'].includes(parsed.protocol) || !parsed.hostname
    || parsed.username || parsed.password || parsed.search || parsed.hash
    || (parsed.pathname !== '/' && parsed.pathname !== '')) {
    throw new Error('UPSTASH_REDIS_REST_URL deve ser uma URL HTTP(S) sem credenciais, caminho ou parâmetros.');
  }
  if (nodeEnv === 'production' && parsed.protocol !== 'https:') {
    throw new Error('UPSTASH_REDIS_REST_URL deve usar HTTPS em produção.');
  }
  return parsed.toString().replace(/\/$/, '');
}

export function loadConfig(environment = process.env) {
  const apiAccessToken = environment.API_ACCESS_TOKEN;
  if (typeof apiAccessToken !== 'string' || apiAccessToken.length < 32) {
    throw new Error('Defina API_ACCESS_TOKEN com pelo menos 32 caracteres antes de iniciar a API.');
  }
  const corsOrigins = (environment.CORS_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean);
  for (const origin of corsOrigins) {
    if (origin === '*') throw new Error('CORS_ORIGINS não permite wildcard.');
    let parsed;
    try { parsed = new URL(origin); } catch { throw new Error('CORS_ORIGINS contém uma origem inválida.'); }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin
      || parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new Error('CORS_ORIGINS deve conter origens HTTP(S) exatas, sem wildcard ou caminho.');
    }
  }
  const databaseUrl = parseDatabaseUrl(environment.DATABASE_URL);
  const nodeEnv = environment.NODE_ENV ?? 'development';
  if (nodeEnv === 'production' && !databaseUrl) throw new Error('DATABASE_URL é obrigatório em NODE_ENV=production.');

  const rateLimitStore = environment.RATE_LIMIT_STORE ?? 'memory';
  if (!['memory', 'upstash'].includes(rateLimitStore)) {
    throw new Error('RATE_LIMIT_STORE deve ser memory ou upstash.');
  }
  let upstashRedisRestUrl = null;
  let upstashRedisRestToken = null;
  if (rateLimitStore === 'upstash') {
    upstashRedisRestUrl = parseUpstashUrl(environment.UPSTASH_REDIS_REST_URL, nodeEnv);
    if (typeof environment.UPSTASH_REDIS_REST_TOKEN !== 'string'
      || environment.UPSTASH_REDIS_REST_TOKEN.trim().length < 16) {
      throw new Error('UPSTASH_REDIS_REST_TOKEN é obrigatório quando RATE_LIMIT_STORE=upstash.');
    }
    upstashRedisRestToken = environment.UPSTASH_REDIS_REST_TOKEN;
  } else if (environment.UPSTASH_REDIS_REST_URL || environment.UPSTASH_REDIS_REST_TOKEN) {
    throw new Error('Configure UPSTASH_REDIS_REST_URL e UPSTASH_REDIS_REST_TOKEN somente com RATE_LIMIT_STORE=upstash.');
  }
  if (nodeEnv === 'production' && rateLimitStore !== 'upstash') {
    throw new Error('RATE_LIMIT_STORE=upstash é obrigatório em produção para quotas compartilhadas.');
  }

  return {
    host: environment.HOST ?? '127.0.0.1',
    port: parsePort(environment.PORT),
    apiAccessToken,
    corsOrigins,
    providerConfigurations: parseProviderConfigurations(environment.PROVIDER_CONFIG_JSON),
    databaseUrl,
    databasePoolMax: parsePoolMax(environment.DATABASE_POOL_MAX),
    rateLimitWindowMs: boundedInteger(environment.RATE_LIMIT_WINDOW_MS, 60_000, 1_000, 3_600_000, 'RATE_LIMIT_WINDOW_MS'),
    rateLimitMax: boundedInteger(environment.RATE_LIMIT_MAX, 120, 1, 100_000, 'RATE_LIMIT_MAX'),
    observabilityWindowMinutes: boundedInteger(environment.OBSERVABILITY_WINDOW_MINUTES, 5, 1, 60, 'OBSERVABILITY_WINDOW_MINUTES'),
    alertMinRequests: boundedInteger(environment.ALERT_MIN_REQUESTS, 20, 1, 100_000, 'ALERT_MIN_REQUESTS'),
    alertP95LatencyMs: boundedInteger(environment.ALERT_P95_LATENCY_MS, 1_000, 1, 60_000, 'ALERT_P95_LATENCY_MS'),
    alertErrorRatePercent: boundedInteger(environment.ALERT_ERROR_RATE_PERCENT, 5, 1, 100, 'ALERT_ERROR_RATE_PERCENT'),
    alert429RatePercent: boundedInteger(environment.ALERT_429_RATE_PERCENT, 20, 1, 100, 'ALERT_429_RATE_PERCENT'),
    alertRssMb: boundedInteger(environment.ALERT_RSS_MB, 512, 1, 65_536, 'ALERT_RSS_MB'),
    rateLimitStore,
    upstashRedisRestUrl,
    upstashRedisRestToken,
    workerIntervalMs: boundedInteger(environment.WORKER_INTERVAL_MS, 5000, 250, 300000, 'WORKER_INTERVAL_MS'),
    workerBatchSize: boundedInteger(environment.WORKER_BATCH_SIZE, 20, 1, 100, 'WORKER_BATCH_SIZE'),
    workerStaleBatchSize: boundedInteger(environment.WORKER_STALE_BATCH_SIZE, 50, 1, 100, 'WORKER_STALE_BATCH_SIZE'),
    workerStaleAfterMs: boundedInteger(environment.WORKER_STALE_AFTER_MS, 300000, 10000, 86400000, 'WORKER_STALE_AFTER_MS'),
    workerLeaseMs: boundedInteger(environment.WORKER_LEASE_MS, 180000, 1000, 900000, 'WORKER_LEASE_MS'),
    nodeEnv
  };
}
