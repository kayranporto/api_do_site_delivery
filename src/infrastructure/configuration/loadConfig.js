function parsePort(value) {
  const port = Number(value ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT deve ser um número inteiro entre 1 e 65535.');
  }
  return port;
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

  return {
    host: environment.HOST ?? '127.0.0.1',
    port: parsePort(environment.PORT),
    apiAccessToken,
    corsOrigins,
    providerConfigurations: parseProviderConfigurations(environment.PROVIDER_CONFIG_JSON)
  };
}
