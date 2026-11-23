import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { requestContext } from './middleware/requestContext.js';
import { apiKeyAuth } from './middleware/apiKeyAuth.js';
import { createRateLimiter } from './middleware/rateLimit.js';
import { createInMemoryRateLimitStore } from '../rate-limits/InMemoryRateLimitStore.js';
import { recordApiClientAuthentication } from './middleware/recordApiClientAuthentication.js';
import { errorHandler } from './middleware/errorHandler.js';
import { createV1Router } from './routes/v1.js';

export function createHttpApp({
  useCases,
  apiAccessToken,
  apiClientRepository,
  executionRepository,
  rateLimitStore,
  corsOrigins = [],
  jsonLimit = '64kb',
  rateLimitWindowMs = 60_000,
  rateLimitMax = 120
}) {
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

  const activeRateLimitStore = rateLimitStore ?? createInMemoryRateLimitStore();
  if (typeof activeRateLimitStore.consume !== 'function'
    || typeof activeRateLimitStore.getClientUsage !== 'function') {
    throw new TypeError('rateLimitStore deve implementar consume() e getClientUsage().');
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

  // Limite compartilhado por IP antes da autenticação para reduzir abuso anônimo.
  app.use('/api/v1', createRateLimiter({
    windowMs: rateLimitWindowMs,
    maxRequests: rateLimitMax,
    rateLimitStore: activeRateLimitStore
  }));
  app.use('/api/v1', apiKeyAuth({ token: apiAccessToken, apiClientRepository }));
  // Quota compartilhada por credencial, antes do parser JSON e da auditoria de autenticação.
  app.use('/api/v1', createRateLimiter({
    windowMs: (req) => req.auth?.rateLimitWindowMs ?? rateLimitWindowMs,
    maxRequests: (req) => req.auth?.rateLimitMax ?? rateLimitMax,
    keyResolver: (req) => req.auth?.clientId ? 'client:' + req.auth.clientId : 'master:' + req.ip,
    usageClientIdResolver: (req) => req.auth?.clientId ?? null,
    rateLimitStore: activeRateLimitStore,
    skip: (req) => req.auth?.isMaster === true
  }));
  app.use('/api/v1', recordApiClientAuthentication({ apiClientRepository }));
  app.use(express.json({ limit: jsonLimit, strict: true, type: 'application/json' }));
  app.use('/api/v1', createV1Router({
    useCases,
    apiClientRepository,
    executionRepository,
    rateLimitStore: activeRateLimitStore
  }));
  app.use((_req, res) => res.status(404).json({
    error: { code: 'ROUTE_NOT_FOUND', message: 'Rota não encontrada.', requestId: res.getHeader('x-request-id') }
  }));
  app.use(errorHandler);
  return app;
}
