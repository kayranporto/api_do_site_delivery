import { timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { requestContext } from './middleware/requestContext.js';
import { apiKeyAuth } from './middleware/apiKeyAuth.js';
import { createRateLimiter } from './middleware/rateLimit.js';
import { createInMemoryRateLimitStore } from '../rate-limits/InMemoryRateLimitStore.js';
import { HttpMetrics } from '../observability/HttpMetrics.js';
import { OperationalAlertEvaluator } from '../observability/OperationalAlertEvaluator.js';
import { AlertMonitor } from '../observability/AlertMonitor.js';
import { renderPrometheusMetrics } from '../observability/PrometheusMetricsExporter.js';
import { recordApiClientAuthentication } from './middleware/recordApiClientAuthentication.js';
import { errorHandler } from './middleware/errorHandler.js';
import { createV1Router } from './routes/v1.js';

function matchesBearerToken(req, expected) {
  const match = /^Bearer ([^\s]+)$/i.exec(req.get('authorization') ?? '');
  if (!match) return false;
  const received = Buffer.from(match[1], 'utf8');
  const configured = Buffer.from(expected, 'utf8');
  return received.length === configured.length && timingSafeEqual(received, configured);
}

export function createHttpApp({
  useCases,
  apiAccessToken,
  apiClientRepository,
  executionRepository,
  rateLimitStore,
  httpMetrics,
  alertEvaluator,
  alertThresholds,
  alertNotifier = null,
  alertMonitor,
  metricsAccessToken = null,
  alertNotificationIntervalMs = 60_000,
  alertNotificationCooldownMs = 300_000,
  readinessChecks = {},
  observabilityWindowMinutes = 5,
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
  if (!readinessChecks || typeof readinessChecks !== 'object' || Array.isArray(readinessChecks)) {
    throw new TypeError('readinessChecks deve ser um objeto de verificações.');
  }
  for (const [name, check] of Object.entries(readinessChecks)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/.test(name) || typeof check !== 'function') {
      throw new TypeError('Cada readiness check deve ter um nome válido e ser uma função.');
    }
  }
  if (!Number.isInteger(observabilityWindowMinutes) || observabilityWindowMinutes < 1 || observabilityWindowMinutes > 60) {
    throw new RangeError('observabilityWindowMinutes deve estar entre 1 e 60.');
  }
  if (metricsAccessToken !== null
    && (typeof metricsAccessToken !== 'string' || metricsAccessToken.length < 32)) {
    throw new TypeError('metricsAccessToken deve ter pelo menos 32 caracteres.');
  }

  const activeRateLimitStore = rateLimitStore ?? createInMemoryRateLimitStore();
  if (typeof activeRateLimitStore.consume !== 'function'
    || typeof activeRateLimitStore.getClientUsage !== 'function') {
    throw new TypeError('rateLimitStore deve implementar consume() e getClientUsage().');
  }
  const activeHttpMetrics = httpMetrics ?? new HttpMetrics();
  if (typeof activeHttpMetrics.middleware !== 'function' || typeof activeHttpMetrics.snapshot !== 'function') {
    throw new TypeError('httpMetrics deve implementar middleware() e snapshot().');
  }
  const activeAlertEvaluator = alertEvaluator ?? new OperationalAlertEvaluator(alertThresholds);
  if (typeof activeAlertEvaluator.evaluate !== 'function') {
    throw new TypeError('alertEvaluator deve implementar evaluate().');
  }
  const activeAlertMonitor = alertMonitor ?? new AlertMonitor({
    httpMetrics: activeHttpMetrics,
    alertEvaluator: activeAlertEvaluator,
    notifier: alertNotifier,
    windowMinutes: observabilityWindowMinutes,
    intervalMs: alertNotificationIntervalMs,
    cooldownMs: alertNotificationCooldownMs,
    onError: () => process.stderr.write('Falha ao entregar alerta operacional ao webhook configurado.\n')
  });
  if (typeof activeAlertMonitor.check !== 'function'
    || typeof activeAlertMonitor.start !== 'function'
    || typeof activeAlertMonitor.stop !== 'function') {
    throw new TypeError('alertMonitor deve implementar check(), start() e stop().');
  }

  const checks = { ...readinessChecks };
  if (!checks.rateLimitStore && typeof activeRateLimitStore.ping === 'function') {
    checks.rateLimitStore = () => activeRateLimitStore.ping();
  }

  const app = express();
  app.disable('x-powered-by');
  app.use(requestContext);
  app.use(activeHttpMetrics.middleware());
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
  const adminDirectory = fileURLToPath(new URL('../../../public/admin/', import.meta.url));
  app.use('/admin/assets', express.static(resolve(adminDirectory, 'assets'), {
    dotfiles: 'deny',
    index: false,
    fallthrough: true,
    maxAge: 0
  }));
  app.get('/admin', (_req, res) => {
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-robots-tag', 'noindex, nofollow');
    return res.sendFile(resolve(adminDirectory, 'index.html'));
  });
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/readyz', async (_req, res) => {
    const results = await Promise.all(Object.entries(checks).map(async ([name, check]) => {
      try {
        const result = await check();
        return [name, result === false ? 'unavailable' : 'ok'];
      } catch {
        return [name, 'unavailable'];
      }
    }));
    const status = results.every(([, result]) => result === 'ok') ? 'ready' : 'not_ready';
    return res.status(status === 'ready' ? 200 : 503).json({
      status,
      checks: Object.fromEntries(results)
    });
  });
  app.get('/metrics', (req, res) => {
    if (!metricsAccessToken) return res.status(404).end();
    if (!matchesBearerToken(req, metricsAccessToken)) {
      res.setHeader('www-authenticate', 'Bearer');
      return res.status(401).json({
        error: { code: 'METRICS_AUTH_REQUIRED', message: 'Autenticação exclusiva de métricas necessária.' }
      });
    }
    const snapshot = activeHttpMetrics.snapshot({ windowMinutes: observabilityWindowMinutes });
    res.setHeader('content-type', 'text/plain; version=0.0.4; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    return res.status(200).send(renderPrometheusMetrics(snapshot));
  });

  app.locals.alertMonitor = activeAlertMonitor;

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
    rateLimitStore: activeRateLimitStore,
    httpMetrics: activeHttpMetrics,
    alertEvaluator: activeAlertEvaluator,
    alertMonitor: activeAlertMonitor,
    observabilityWindowMinutes
  }));
  app.use((_req, res) => res.status(404).json({
    error: { code: 'ROUTE_NOT_FOUND', message: 'Rota não encontrada.', requestId: res.getHeader('x-request-id') }
  }));
  app.use(errorHandler);
  return app;
}
