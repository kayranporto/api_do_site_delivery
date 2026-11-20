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

  return {
    host: environment.HOST ?? '127.0.0.1',
    port: parsePort(environment.PORT),
    apiAccessToken,
    corsOrigins,
    providerConfigurations: parseProviderConfigurations(environment.PROVIDER_CONFIG_JSON),
    databaseUrl,
    databasePoolMax: parsePoolMax(environment.DATABASE_POOL_MAX),
    workerIntervalMs: boundedInteger(environment.WORKER_INTERVAL_MS, 5000, 250, 300000, 'WORKER_INTERVAL_MS'),
    workerBatchSize: boundedInteger(environment.WORKER_BATCH_SIZE, 20, 1, 100, 'WORKER_BATCH_SIZE'),
    workerStaleBatchSize: boundedInteger(environment.WORKER_STALE_BATCH_SIZE, 50, 1, 100, 'WORKER_STALE_BATCH_SIZE'),
    workerStaleAfterMs: boundedInteger(environment.WORKER_STALE_AFTER_MS, 300000, 10000, 86400000, 'WORKER_STALE_AFTER_MS'),
    workerLeaseMs: boundedInteger(environment.WORKER_LEASE_MS, 180000, 1000, 900000, 'WORKER_LEASE_MS'),
    nodeEnv
  };
}
