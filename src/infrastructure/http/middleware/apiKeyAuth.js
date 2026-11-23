import { timingSafeEqual } from 'node:crypto';
import { hashApiKey } from '../../security/RandomApiKeyGenerator.js';

const ALL_SCOPES = [
  'integrations:read',
  'integrations:manage',
  'executions:read',
  'executions:write',
  'executions:reconcile',
  'observability:read'
];

function equalSecret(received, expected) {
  const a = Buffer.from(received, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

function equalHash(received, expected) {
  const a = Buffer.from(received, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function apiKeyAuth({ token, apiClientRepository }) {
  if (typeof token !== 'string' || token.length < 32) {
    throw new Error('API_ACCESS_TOKEN deve ter pelo menos 32 caracteres.');
  }

  return async function authenticateApiKey(req, res, next) {
    const authorization = req.get('authorization') ?? '';
    const match = /^Bearer ([^\s]+)$/i.exec(authorization);
    if (!match) return unauthorized(req, res);

    const supplied = match[1];
    if (equalSecret(supplied, token)) {
      req.auth = {
        isMaster: true,
        clientId: null,
        scopes: ALL_SCOPES,
        integrationIds: null
      };
      return next();
    }

    const keyMatch = /^gik_([a-f0-9]{16})\.([A-Za-z0-9_-]{43})$/.exec(supplied);
    if (!keyMatch || !apiClientRepository) return unauthorized(req, res);

    const client = await apiClientRepository.findActiveByPrefix(keyMatch[1]);
    if (!client || !equalHash(hashApiKey(supplied), client.keyHash)) return unauthorized(req, res);

    req.auth = {
      isMaster: false,
      clientId: client.id,
      scopes: client.scopes,
      integrationIds: client.integrationIds
    };

    try {
      await apiClientRepository.recordAudit({
        clientId: client.id,
        action: 'authenticated',
        requestId: req.requestId,
        createdAt: new Date()
      });
    } catch {
      // A indisponibilidade da trilha de auditoria não converte uma chave válida em erro de autenticação.
    }
    return next();
  };
}

function unauthorized(req, res) {
  res.setHeader('www-authenticate', 'Bearer');
  return res.status(401).json({
    error: {
      code: 'UNAUTHORIZED',
      message: 'Autenticação necessária.',
      requestId: req.requestId
    }
  });
}
