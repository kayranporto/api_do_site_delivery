function parsePort(value) {
  const port = Number(value ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT deve ser um número inteiro entre 1 e 65535.');
  }
  return port;
}

function parsePoolMax(value) {
  const max = Number(value ?? 10);
  if (!Number.isInteger(max) || max < 1 || max > 50) {
    throw new Error('DATABASE_POOL_MAX deve ser um número inteiro entre 1 e 50.');
  }
  return max;
}

function parseProviderConfigurations(value) {
  if (!value) return {};
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('PROVIDER_CONFIG_JSON deve conter um objeto JSON válido.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('PROVIDER_CONFIG_JSON deve conter um objeto JSON.');
  }
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

  const corsOrigins = (environment.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  for (const origin of corsOrigins) {
    if (origin === '*') throw new Error('CORS_ORIGINS não permite wildcard.');
    let parsed;
    try { parsed = new URL(origin); } catch { throw new Error('CORS_ORIGINS contém uma origem inválida.'); }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin
      || parsed.username || parsed.password || parsed.search || parsed.hash || origin === '*') {
      throw new Error('CORS_ORIGINS deve conter origens HTTP(S) exatas, sem wildcard ou caminho.');
    }
  }

  const databaseUrl = parseDatabaseUrl(environment.DATABASE_URL);
  const nodeEnv = environment.NODE_ENV ?? 'development';
  if (nodeEnv === 'production' && !databaseUrl) {
    throw new Error('DATABASE_URL é obrigatório em NODE_ENV=production.');
  }

  return {
    host: environment.HOST ?? '127.0.0.1',
    port: parsePort(environment.PORT),
    apiAccessToken,
    corsOrigins,
    providerConfigurations: parseProviderConfigurations(environment.PROVIDER_CONFIG_JSON),
    databaseUrl,
    databasePoolMax: parsePoolMax(environment.DATABASE_POOL_MAX),
    nodeEnv
  };
}
