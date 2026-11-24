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
  if (value == null || (typeof value === 'string' && value.trim() === '')) return null;
  if (typeof value !== 'string') throw new Error('DATABASE_URL deve ser uma URL PostgreSQL válida.');
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error('DATABASE_URL deve ser uma URL PostgreSQL válida.'); }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname) {
    throw new Error('DATABASE_URL deve usar o protocolo postgres:// ou postgresql://.');
  }
  return value;
}
function parseSecret(value, name, minimumLength) {
  const isPlaceholder = typeof value === 'string'
    && /^(replace-with|change-me|changeme|your[-_]|example[-_])/i.test(value);
  if (typeof value !== 'string' || value.length < minimumLength
    || value.trim() !== value || /\s/.test(value) || isPlaceholder) {
    throw new Error(name + ' deve ter pelo menos ' + minimumLength
      + ' caracteres, sem espaços e sem valores de exemplo.');
  }
  return value;
}
function ensureDistinctSecrets(secrets) {
  const seen = new Set();
  for (const [name, value] of secrets) {
    if (value === null || value === undefined) continue;
    if (seen.has(value)) {
      throw new Error(name + ' deve ser diferente dos demais segredos configurados.');
    }
    seen.add(value);
  }
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
function parseClientIpHeader(value) {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return null;
  if (typeof value !== 'string' || value.trim().toLowerCase() !== 'cf-connecting-ip') {
    throw new Error('CLIENT_IP_HEADER aceita somente CF-Connecting-IP; não use cabeçalhos encaminhados controláveis pelo cliente.');
  }
  return 'cf-connecting-ip';
}
function parseWebhookUrl(value) {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return null;
  if (typeof value !== 'string') throw new Error('ALERT_WEBHOOK_URL deve ser uma URL HTTPS válida.');
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error('ALERT_WEBHOOK_URL deve ser uma URL válida.'); }
  if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password || parsed.hash || parsed.search) {
    throw new Error('ALERT_WEBHOOK_URL deve usar HTTPS, sem credenciais, query string ou fragmento.');
  }
  return parsed.toString();
}

export function loadConfig(environment = process.env) {
  const nodeEnv = environment.NODE_ENV ?? 'development';
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    throw new Error('NODE_ENV deve ser development, test ou production.');
  }

  const apiAccessToken = parseSecret(environment.API_ACCESS_TOKEN, 'API_ACCESS_TOKEN', 32);
  const corsOrigins = (environment.CORS_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean);
  for (const origin of corsOrigins) {
    if (origin === '*') throw new Error('CORS_ORIGINS não permite wildcard.');
    let parsed;
    try { parsed = new URL(origin); } catch { throw new Error('CORS_ORIGINS contém uma origem inválida.'); }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin
      || parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new Error('CORS_ORIGINS deve conter origens HTTP(S) exatas, sem wildcard ou caminho.');
    }
    if (nodeEnv === 'production' && parsed.protocol !== 'https:') {
      throw new Error('CORS_ORIGINS deve usar HTTPS em produção.');
    }
  }
  const clientIpHeader = parseClientIpHeader(environment.CLIENT_IP_HEADER);
  const databaseUrl = parseDatabaseUrl(environment.DATABASE_URL);
  if (nodeEnv === 'production' && !databaseUrl) throw new Error('DATABASE_URL é obrigatório em NODE_ENV=production.');

  const rateLimitStore = environment.RATE_LIMIT_STORE ?? 'memory';
  if (!['memory', 'upstash'].includes(rateLimitStore)) {
    throw new Error('RATE_LIMIT_STORE deve ser memory ou upstash.');
  }
  let upstashRedisRestUrl = null;
  let upstashRedisRestToken = null;
  if (rateLimitStore === 'upstash') {
    upstashRedisRestUrl = parseUpstashUrl(environment.UPSTASH_REDIS_REST_URL, nodeEnv);
    upstashRedisRestToken = parseSecret(environment.UPSTASH_REDIS_REST_TOKEN, 'UPSTASH_REDIS_REST_TOKEN', 16);
  } else if (environment.UPSTASH_REDIS_REST_URL || environment.UPSTASH_REDIS_REST_TOKEN) {
    throw new Error('Configure UPSTASH_REDIS_REST_URL e UPSTASH_REDIS_REST_TOKEN somente com RATE_LIMIT_STORE=upstash.');
  }
  if (nodeEnv === 'production' && rateLimitStore !== 'upstash') {
    throw new Error('RATE_LIMIT_STORE=upstash é obrigatório em produção para quotas compartilhadas.');
  }

  const metricsAccessToken = environment.METRICS_ACCESS_TOKEN == null
    ? null
    : parseSecret(environment.METRICS_ACCESS_TOKEN, 'METRICS_ACCESS_TOKEN', 32);
  if (nodeEnv === 'production' && !metricsAccessToken) {
    throw new Error('METRICS_ACCESS_TOKEN é obrigatório em produção para proteger /metrics.');
  }

  const alertWebhookUrl = parseWebhookUrl(environment.ALERT_WEBHOOK_URL);
  let alertWebhookToken = null;
  if (environment.ALERT_WEBHOOK_TOKEN !== undefined && environment.ALERT_WEBHOOK_TOKEN !== '') {
    if (!alertWebhookUrl) throw new Error('ALERT_WEBHOOK_TOKEN exige ALERT_WEBHOOK_URL.');
    alertWebhookToken = parseSecret(environment.ALERT_WEBHOOK_TOKEN, 'ALERT_WEBHOOK_TOKEN', 16);
  }
  ensureDistinctSecrets([
    ['API_ACCESS_TOKEN', apiAccessToken],
    ['UPSTASH_REDIS_REST_TOKEN', upstashRedisRestToken],
    ['METRICS_ACCESS_TOKEN', metricsAccessToken],
    ['ALERT_WEBHOOK_TOKEN', alertWebhookToken]
  ]);

  return {
    host: environment.HOST ?? '127.0.0.1',
    clientIpHeader,
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
    metricsAccessToken,
    alertWebhookUrl,
    alertWebhookToken,
    alertNotificationIntervalMs: boundedInteger(environment.ALERT_NOTIFICATION_INTERVAL_MS, 60_000, 5_000, 3_600_000, 'ALERT_NOTIFICATION_INTERVAL_MS'),
    alertNotificationCooldownMs: boundedInteger(environment.ALERT_NOTIFICATION_COOLDOWN_MS, 300_000, 10_000, 86_400_000, 'ALERT_NOTIFICATION_COOLDOWN_MS'),
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
