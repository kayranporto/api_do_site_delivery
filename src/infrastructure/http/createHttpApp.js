import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { requestContext } from './middleware/requestContext.js';
import { apiKeyAuth } from './middleware/apiKeyAuth.js';
import { errorHandler } from './middleware/errorHandler.js';
import { createV1Router } from './routes/v1.js';

export function createHttpApp({ useCases, apiAccessToken, corsOrigins = [], jsonLimit = '64kb' }) {
  if (!useCases || typeof useCases !== 'object') {
    throw new TypeError('useCases é obrigatório para compor a API HTTP.');
  }
  if (!Array.isArray(corsOrigins) || corsOrigins.some((origin) => {
    if (typeof origin !== 'string' || origin === '*') return true;
    try {
      const parsed = new URL(origin);
      return !['http:', 'https:'].includes(parsed.protocol)
        || parsed.origin !== origin
        || Boolean(parsed.username || parsed.password || parsed.search || parsed.hash);
    } catch {
      return true;
    }
  })) {
    throw new TypeError('corsOrigins deve conter origens HTTP(S) exatas; wildcard não é permitido.');
  }

  const app = express();
  app.disable('x-powered-by');
  app.use(requestContext);
  app.use(helmet());
  app.use(cors({
    origin(origin, callback) {
      if (!origin) return callback(null, false);
      return callback(null, corsOrigins.includes(origin));
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 600
  }));
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  // Autentica antes de processar JSON para reduzir o custo de requisições anônimas.
  app.use('/api/v1', apiKeyAuth({ token: apiAccessToken }));
  app.use(express.json({ limit: jsonLimit, strict: true, type: 'application/json' }));
  app.use('/api/v1', createV1Router({ useCases }));
  app.use((_req, res) => res.status(404).json({
    error: { code: 'ROUTE_NOT_FOUND', message: 'Rota não encontrada.', requestId: res.getHeader('x-request-id') }
  }));
  app.use(errorHandler);
  return app;
}
