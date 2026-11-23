import { Router } from 'express';
import { validateBody } from '../middleware/validateBody.js';
import {
  requireExecutionAccess,
  requireIntegrationAccess,
  requireMaster,
  requireScope
} from '../middleware/authorization.js';
import {
  createIntegrationSchema,
  executeOperationSchema,
  createApiClientSchema,
  apiClientAuditQuerySchema
} from './schemas.js';

function integrationResource(integration) {
  return {
    id: integration.id,
    name: integration.name,
    providerKey: integration.providerKey.value,
    status: integration.status,
    active: integration.isActive,
    timeoutMs: integration.timeoutMs,
    retryPolicy: integration.retryPolicy.toJSON(),
    secretConfigured: Boolean(integration.secretReference),
    createdAt: integration.createdAt.toISOString(),
    updatedAt: integration.updatedAt.toISOString()
  };
}

function eventResource(event) {
  const allowedDetails = new Set([
    'attempt', 'errorCode', 'retryable', 'status', 'outcome',
    'providerStatus', 'reason', 'durationMs'
  ]);
  const details = {};
  for (const [key, value] of Object.entries(event.details ?? {})) {
    if (!allowedDetails.has(key)) continue;
    if (typeof value === 'string') details[key] = value.slice(0, 120);
    else if (typeof value === 'number' && Number.isFinite(value)) details[key] = value;
    else if (typeof value === 'boolean') details[key] = value;
  }
  return {
    id: event.id,
    eventType: event.eventType,
    severity: event.severity,
    details,
    createdAt: event.createdAt.toISOString()
  };
}

function executionResource(execution) {
  return {
    id: execution.id,
    integrationId: execution.integrationId,
    operationName: execution.operationName.value,
    status: execution.status,
    attemptCount: execution.attemptCount,
    attempts: execution.attempts.map((attempt) => ({
      number: attempt.number,
      status: attempt.status,
      startedAt: attempt.startedAt.toISOString(),
      endedAt: attempt.endedAt?.toISOString() ?? null,
      errorCode: attempt.errorCode
    })),
    nextAttemptAt: execution.nextAttemptAt?.toISOString() ?? null,
    completedAt: execution.completedAt?.toISOString() ?? null,
    createdAt: execution.createdAt.toISOString()
  };
}

function apiClientResource(client) {
  return {
    id: client.id,
    name: client.name,
    keyPrefix: client.keyPrefix,
    scopes: client.scopes,
    integrationIds: client.integrationIds,
    createdAt: client.createdAt.toISOString(),
    revokedAt: client.revokedAt?.toISOString() ?? null,
    lastUsedAt: client.lastUsedAt?.toISOString() ?? null
  };
}

export function createV1Router({ useCases, apiClientRepository, executionRepository }) {
  const router = Router();
  const executionAccess = requireExecutionAccess(executionRepository);

  // Gestão de credenciais administrativas: somente o token de serviço legado/master.
  router.post('/clients', requireMaster, validateBody(createApiClientSchema), async (req, res) => {
    const result = await useCases.createApiClient.execute(req.validatedBody);
    return res.status(201).json({
      data: apiClientResource(result.client),
      credential: result.credential,
      meta: { credentialShownOnce: true }
    });
  });

  router.get('/clients', requireMaster, async (_req, res) => {
    const clients = await useCases.listApiClients.execute();
    return res.json({ data: clients.map(apiClientResource) });
  });

  router.post('/clients/:clientId/revoke', requireMaster, async (req, res) => {
    const client = await useCases.revokeApiClient.execute({ clientId: req.params.clientId });
    if (!client) {
      return res.status(404).json({
        error: { code: 'CLIENT_NOT_FOUND', message: 'Credencial não encontrada.', requestId: req.requestId }
      });
    }
    return res.json({ data: apiClientResource(client) });
  });

  router.get('/clients/:clientId/audit', requireMaster, async (req, res) => {
    const parsed = apiClientAuditQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        error: { code: 'INVALID_AUDIT_LIMIT', message: 'limit deve ser um inteiro entre 1 e 500.', requestId: req.requestId }
      });
    }
    const clients = await useCases.listApiClients.execute();
    if (!clients.some((client) => client.id === req.params.clientId)) {
      return res.status(404).json({
        error: { code: 'CLIENT_NOT_FOUND', message: 'Credencial não encontrada.', requestId: req.requestId }
      });
    }
    const events = await useCases.listApiClientAudit.execute({
      clientId: req.params.clientId,
      limit: parsed.data.limit
    });
    return res.json({
      data: events.map((event) => ({
        id: event.id,
        action: event.action,
        requestId: event.requestId,
        createdAt: event.createdAt.toISOString()
      }))
    });
  });

  // Criar integrações segue restrito à credencial master.
  router.post('/integrations', requireMaster, validateBody(createIntegrationSchema), async (req, res) => {
    const integration = await useCases.createIntegration.execute(req.validatedBody);
    return res.status(201).json({ data: integrationResource(integration) });
  });

  router.get('/integrations', requireScope('integrations:read'), async (req, res) => {
    const integrations = await useCases.listActiveIntegrations.execute();
    const allowed = req.auth.integrationIds;
    const visible = allowed === null ? integrations : integrations.filter((item) => allowed.includes(item.id));
    return res.json({ data: visible.map(integrationResource) });
  });

  router.get('/integrations/:integrationId',
    requireScope('integrations:read'),
    requireIntegrationAccess,
    async (req, res) => {
      const integration = await useCases.getIntegration.execute({ integrationId: req.params.integrationId });
      return res.json({ data: integrationResource(integration) });
    });

  router.post('/integrations/:integrationId/activate',
    requireScope('integrations:manage'),
    requireIntegrationAccess,
    async (req, res) => {
      const integration = await useCases.activateIntegration.execute({ integrationId: req.params.integrationId });
      return res.json({ data: integrationResource(integration) });
    });

  router.post('/integrations/:integrationId/deactivate',
    requireScope('integrations:manage'),
    requireIntegrationAccess,
    async (req, res) => {
      const integration = await useCases.deactivateIntegration.execute({ integrationId: req.params.integrationId });
      return res.json({ data: integrationResource(integration) });
    });

  router.post('/integrations/:integrationId/operations',
    requireScope('executions:write'),
    requireIntegrationAccess,
    validateBody(executeOperationSchema),
    async (req, res) => {
      const headerKey = req.get('idempotency-key');
      const bodyKey = req.validatedBody.idempotencyKey;
      if (headerKey && bodyKey && headerKey !== bodyKey) {
        return res.status(400).json({
          error: {
            code: 'IDEMPOTENCY_KEY_MISMATCH',
            message: 'O header Idempotency-Key difere do valor informado no corpo.',
            requestId: req.requestId
          }
        });
      }
      const outcome = await useCases.executeOperation.execute({
        integrationId: req.params.integrationId,
        ...req.validatedBody,
        idempotencyKey: headerKey ?? bodyKey
      });
      return res.status(outcome.replayed ? 200 : 201).json({
        data: executionResource(outcome.execution),
        meta: { replayed: outcome.replayed, result: outcome.result ?? null }
      });
    });

  router.get('/observability/metrics', requireScope('observability:read'), async (req, res) => {
    const rawWindow = req.query.windowHours;
    const windowHours = rawWindow === undefined ? 24 : Number(rawWindow);
    if (!Number.isInteger(windowHours) || windowHours < 1 || windowHours > 720) {
      return res.status(400).json({
        error: {
          code: 'INVALID_METRICS_WINDOW',
          message: 'windowHours deve ser um inteiro entre 1 e 720.',
          requestId: req.requestId
        }
      });
    }
    const metrics = await useCases.getOperationalMetrics.execute({ windowHours });
    return res.json({ data: metrics });
  });

  router.get('/executions/:executionId/events',
    requireScope('executions:read'), executionAccess,
    async (req, res) => {
      const rawLimit = req.query.limit;
      const limit = rawLimit === undefined ? 100 : Number(rawLimit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
        return res.status(400).json({
          error: {
            code: 'INVALID_EVENT_LIMIT',
            message: 'limit deve ser um inteiro entre 1 e 500.',
            requestId: req.requestId
          }
        });
      }
      const events = await useCases.getExecutionEvents.execute({
        executionId: req.params.executionId,
        limit
      });
      return res.json({ data: events.map(eventResource) });
    });

  router.post('/executions/:executionId/reconcile',
    requireScope('executions:reconcile'), executionAccess,
    async (req, res) => {
      const result = await useCases.reconcileInterruptedExecution.execute({
        executionId: req.params.executionId
      });
      return res.json({ data: result });
    });

  router.get('/executions/:executionId',
    requireScope('executions:read'), executionAccess,
    async (req, res) => {
      const execution = await useCases.getExecution.execute({ executionId: req.params.executionId });
      return res.json({ data: executionResource(execution) });
    });

  router.post('/executions/:executionId/cancel',
    requireScope('executions:write'), executionAccess,
    async (req, res) => {
      const execution = await useCases.cancelExecution.execute({ executionId: req.params.executionId });
      return res.json({ data: executionResource(execution) });
    });

  return router;
}
