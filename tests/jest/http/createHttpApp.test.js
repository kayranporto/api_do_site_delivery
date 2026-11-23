import { beforeEach, describe, expect, test } from '@jest/globals';
import request from 'supertest';
import { createContainer } from '../../../src/bootstrap/createContainer.js';
import { createHttpApp } from '../../../src/infrastructure/http/createHttpApp.js';
import { Execution } from '../../../src/domain/entities/Execution.js';

const API_TOKEN = 'test-token-with-at-least-thirty-two-characters-long';

function makeApp() {
  const container = createContainer({ environment: {} });
  const app = createHttpApp({
    useCases: container.useCases,
    apiAccessToken: API_TOKEN,
    apiClientRepository: container.repositories.apiClientRepository,
    executionRepository: container.repositories.executionRepository,
    corsOrigins: ['https://client.example.test']
  });
  return { app, container };
}

const auth = (req) => req.set('Authorization', `Bearer ${API_TOKEN}`);

const integrationBody = {
  name: 'Example CRM',
  providerKey: 'example-provider',
  configurationReference: 'config:example:default',
  secretReference: 'env:EXAMPLE_PROVIDER_TOKEN',
  timeoutMs: 5000,
  retryPolicy: {
    maxAttempts: 3,
    initialDelayMs: 1000,
    maxDelayMs: 10000,
    backoffMultiplier: 2
  }
};

describe('HTTP API', () => {
  let app;
  let container;

  beforeEach(() => {
    ({ app, container } = makeApp());
  });

  test('health é público e adiciona request ID e Helmet headers', async () => {
    const response = await request(app).get('/health').expect(200);
    expect(response.body).toEqual({ status: 'ok' });
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/i);
    expect(response.headers['content-security-policy']).toBeDefined();
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  test('rotas da API exigem token Bearer', async () => {
    const response = await request(app).get('/api/v1/integrations').expect(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
    expect(response.headers['www-authenticate']).toBe('Bearer');
  });

  test('cria integração sem expor referências internas ou segredos', async () => {
    const response = await auth(request(app).post('/api/v1/integrations'))
      .send(integrationBody)
      .expect(201);

    expect(response.body.data.name).toBe('Example CRM');
    expect(response.body.data.status).toBe('inactive');
    expect(response.body.data.secretConfigured).toBe(true);
    expect(response.body.data).not.toHaveProperty('secretReference');
    expect(response.body.data).not.toHaveProperty('configurationReference');
  });

  test('Zod rejeita propriedades desconhecidas', async () => {
    const response = await auth(request(app).post('/api/v1/integrations'))
      .send({ ...integrationBody, isAdmin: true })
      .expect(400);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.issues.length).toBeGreaterThan(0);
  });

  test('ativa, executa e consulta uma operação sem expor input nem chave idempotente', async () => {
    const created = await auth(request(app).post('/api/v1/integrations'))
      .send(integrationBody)
      .expect(201);
    const integrationId = created.body.data.id;

    await auth(request(app).post(`/api/v1/integrations/${integrationId}/activate`)).expect(200);

    container.adapters.providerRegistry.register('example-provider', {
      async execute() {
        return { externalId: 'external-123' };
      }
    });

    const result = await auth(request(app).post(`/api/v1/integrations/${integrationId}/operations`))
      .set('Idempotency-Key', 'http-operation-12345678')
      .send({ operationName: 'records.create', payload: { name: 'Example' } })
      .expect((response) => {
        if (response.status !== 201) throw new Error('Operation request failed: ' + JSON.stringify(response.body));
      });

    expect(result.body.data.status).toBe('succeeded');
    expect(result.body.meta.result).toEqual({ externalId: 'external-123' });
    expect(result.body.data).not.toHaveProperty('input');
    expect(result.body.data).not.toHaveProperty('idempotencyKey');

    const fetched = await auth(request(app).get(`/api/v1/executions/${result.body.data.id}`)).expect(200);
    expect(fetched.body.data.status).toBe('succeeded');
  });

  test('CORS adiciona allow-origin somente para origem aprovada', async () => {
    const allowed = await request(app).get('/health')
      .set('Origin', 'https://client.example.test')
      .expect(200);
    const denied = await request(app).get('/health')
      .set('Origin', 'https://attacker.example.test')
      .expect(200);

    expect(allowed.headers['access-control-allow-origin']).toBe('https://client.example.test');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  test('métricas operacionais são protegidas por token e agregam estados/eventos', async () => {
    await request(app).get('/api/v1/observability/metrics').expect(401);
    const response = await auth(request(app).get('/api/v1/observability/metrics?windowHours=24')).expect(200);
    expect(response.body.data.windowHours).toBe(24);
    expect(response.body.data.executionsByStatus.pending).toBe(0);
    expect(response.body.data.events.total).toBe(0);
  });

  test('reconcilia execução interrupted e expõe eventos sem modificar seu estado', async () => {
    const created = await auth(request(app).post('/api/v1/integrations'))
      .send(integrationBody)
      .expect(201);
    const integrationId = created.body.data.id;
    const execution = new Execution({
      id: 'execution-http-reconciliation',
      integrationId,
      operationName: 'records.create',
      createdAt: new Date('2026-07-01T10:00:00.000Z')
    });
    execution.interrupt(new Date('2026-07-01T10:01:00.000Z'));
    await container.repositories.executionRepository.save(execution);

    const reconciled = await auth(request(app)
      .post('/api/v1/executions/execution-http-reconciliation/reconcile'))
      .expect(200);
    expect(reconciled.body.data.outcome).toBe('unsupported');
    expect(reconciled.body.data.executionStatus).toBe('interrupted');

    const saved = await container.repositories.executionRepository.findById(execution.id);
    expect(saved.status).toBe('interrupted');
    const events = await auth(request(app)
      .get('/api/v1/executions/execution-http-reconciliation/events'))
      .expect(200);
    expect(events.body.data.map((event) => event.eventType)).toContain('execution.reconciliation_unsupported');
  });

  test('métricas rejeitam janela inválida', async () => {
    const response = await auth(request(app).get('/api/v1/observability/metrics?windowHours=721')).expect(400);
    expect(response.body.error.code).toBe('INVALID_METRICS_WINDOW');
  });

});
