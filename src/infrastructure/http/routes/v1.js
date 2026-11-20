import { Router } from 'express';
import { validateBody } from '../middleware/validateBody.js';
import { createIntegrationSchema, executeOperationSchema } from './schemas.js';

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

export function createV1Router({ useCases }) {
  const router = Router();

  router.post('/integrations', validateBody(createIntegrationSchema), async (req, res) => {
    const integration = await useCases.createIntegration.execute(req.validatedBody);
    return res.status(201).json({ data: integrationResource(integration) });
  });

  router.get('/integrations', async (_req, res) => {
    const integrations = await useCases.listActiveIntegrations.execute();
    return res.json({ data: integrations.map(integrationResource) });
  });

  router.get('/integrations/:integrationId', async (req, res) => {
    const integration = await useCases.getIntegration.execute({ integrationId: req.params.integrationId });
    return res.json({ data: integrationResource(integration) });
  });

  router.post('/integrations/:integrationId/activate', async (req, res) => {
    const integration = await useCases.activateIntegration.execute({ integrationId: req.params.integrationId });
    return res.json({ data: integrationResource(integration) });
  });

  router.post('/integrations/:integrationId/deactivate', async (req, res) => {
    const integration = await useCases.deactivateIntegration.execute({ integrationId: req.params.integrationId });
    return res.json({ data: integrationResource(integration) });
  });

  router.post('/integrations/:integrationId/operations', validateBody(executeOperationSchema), async (req, res) => {
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

  router.get('/executions/:executionId', async (req, res) => {
    const execution = await useCases.getExecution.execute({ executionId: req.params.executionId });
    return res.json({ data: executionResource(execution) });
  });

  router.post('/executions/:executionId/cancel', async (req, res) => {
    const execution = await useCases.cancelExecution.execute({ executionId: req.params.executionId });
    return res.json({ data: executionResource(execution) });
  });

  return router;
}
