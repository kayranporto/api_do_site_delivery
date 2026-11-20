function boundedInteger(value, fallback, min, max, name) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(name + ' deve ser um inteiro entre ' + min + ' e ' + max + '.');
  }
  return parsed;
}

function databaseUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('DATABASE_URL é obrigatório para executar o worker.');
  }
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error('DATABASE_URL inválida.'); }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname) {
    throw new Error('DATABASE_URL deve usar postgres:// ou postgresql://.');
  }
  return value;
}

export function loadWorkerConfig(environment = process.env) {
  return {
    databaseUrl: databaseUrl(environment.DATABASE_URL),
    databasePoolMax: boundedInteger(environment.DATABASE_POOL_MAX, 10, 1, 50, 'DATABASE_POOL_MAX'),
    intervalMs: boundedInteger(environment.WORKER_INTERVAL_MS, 5000, 250, 300000, 'WORKER_INTERVAL_MS'),
    batchSize: boundedInteger(environment.WORKER_BATCH_SIZE, 20, 1, 100, 'WORKER_BATCH_SIZE'),
    staleBatchSize: boundedInteger(environment.WORKER_STALE_BATCH_SIZE, 50, 1, 100, 'WORKER_STALE_BATCH_SIZE'),
    staleAfterMs: boundedInteger(environment.WORKER_STALE_AFTER_MS, 300000, 10000, 86400000, 'WORKER_STALE_AFTER_MS'),
    leaseMs: boundedInteger(environment.WORKER_LEASE_MS, 180000, 1000, 900000, 'WORKER_LEASE_MS')
  };
}
