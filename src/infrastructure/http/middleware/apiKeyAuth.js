import { timingSafeEqual } from 'node:crypto';

function equalSecret(received, expected) {
  const a = Buffer.from(received, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function apiKeyAuth({ token }) {
  if (typeof token !== 'string' || token.length < 32) {
    throw new Error('API_ACCESS_TOKEN deve ter pelo menos 32 caracteres.');
  }

  return function authenticateApiKey(req, res, next) {
    const authorization = req.get('authorization') ?? '';
    const match = /^Bearer ([^\s]+)$/i.exec(authorization);
    if (!match || !equalSecret(match[1], token)) {
      res.setHeader('www-authenticate', 'Bearer');
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Autenticação necessária.',
          requestId: req.requestId
        }
      });
    }
    return next();
  };
}
