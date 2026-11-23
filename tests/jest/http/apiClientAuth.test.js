import { beforeEach, describe, expect, test } from '@jest/globals';
import request from 'supertest';
import { createContainer } from '../../../src/bootstrap/createContainer.js';
import { createHttpApp } from '../../../src/infrastructure/http/createHttpApp.js';
import { Execution } from '../../../src/domain/entities/Execution.js';

const MASTER_TOKEN = 'master-test-token-with-at-least-thirty-two-characters';

const integrationBody = (name) => ({
  name,
  providerKey: 'example-provider',
  configurationReference: 'config:example:default',
  secretReference: null,
  timeoutMs: 5000,
  retryPolicy: {
    maxAttempts: 3,
    initialDelayMs: 1000,
    maxDelayMs: 10000,
    backoffMultiplier: 2
  }
});

describe('API client authentication and authorization', () => {
  let app;
  let container;
  const master = (req) => req.set('Authorization', 'Bearer ' + MASTER_TOKEN);

  beforeEach(() => {
    container = createContainer({ environment: {} });
    app = createHttpApp({
      useCases: container.useCases,
      apiAccessToken: MASTER_TOKEN,
      apiClientRepository: container.repositories.apiClientRepository,
      executionRepository: container.repositories.executionRepository
    });
  });

  test('scopes and integration allowlist constrain collection, resources and executions', async () => {
    const first = await master(request(app).post('/api/v1/integrations'))
      .send(integrationBody('Client A integration')).expect(201);
    const second = await master(request(app).post('/api/v1/integrations'))
      .send(integrationBody('Client B integration')).expect(201);
    const firstId = first.body.data.id;
    const secondId = second.body.data.id;

    await master(request(app).post('/api/v1/integrations/' + firstId + '/activate')).expect(200);
    await master(request(app).post('/api/v1/integrations/' + secondId + '/activate')).expect(200);

    const firstExecution = new Execution({
      id: 'execution-visible-to-client',
      integrationId: firstId,
      operationName: 'records.read',
      createdAt: new Date('2026-11-23T10:00:00.000Z')
    });
    const secondExecution = new Execution({
      id: 'execution-hidden-from-client',
      integrationId: secondId,
      operationName: 'records.read',
      createdAt: new Date('2026-11-23T10:00:00.000Z')
    });
    await container.repositories.executionRepository.save(firstExecution);
    await container.repositories.executionRepository.save(secondExecution);

    const created = await master(request(app).post('/api/v1/clients'))
      .send({
        name: 'Read-only integration client',
        scopes: ['integrations:read', 'executions:read'],
        integrationIds: [firstId]
      }).expect(201);

    const credential = created.body.credential;
    expect(credential).toMatch(/^gik_[a-f0-9]{16}\.[A-Za-z0-9_-]{43}$/);
    expect(created.body.meta.credentialShownOnce).toBe(true);
    expect(created.body.data).not.toHaveProperty('keyHash');
    expect(created.body.data).not.toHaveProperty('credential');

    const client = (req) => req.set('Authorization', 'Bearer ' + credential);
    const integrations = await client(request(app).get('/api/v1/integrations')).expect(200);
    expect(integrations.body.data.map((item) => item.id)).toEqual([firstId]);

    await client(request(app).get('/api/v1/integrations/' + firstId)).expect(200);
    const hiddenIntegration = await client(request(app).get('/api/v1/integrations/' + secondId)).expect(404);
    expect(hiddenIntegration.body.error.code).toBe('RESOURCE_NOT_FOUND');

    const visibleExecution = await client(request(app).get('/api/v1/executions/' + firstExecution.id)).expect(200);
    expect(visibleExecution.body.data.integrationId).toBe(firstId);
    await client(request(app).get('/api/v1/executions/' + secondExecution.id)).expect(404);

    const noManage = await client(request(app).post('/api/v1/integrations/' + firstId + '/deactivate')).expect(403);
    expect(noManage.body.error.code).toBe('INSUFFICIENT_SCOPE');
    await client(request(app).get('/api/v1/observability/metrics')).expect(403);
    const cannotCreateIntegration = await client(request(app).post('/api/v1/integrations'))
      .send(integrationBody('Not allowed')).expect(403);
    expect(cannotCreateIntegration.body.error.code).toBe('MASTER_CREDENTIAL_REQUIRED');
    await client(request(app).get('/api/v1/clients')).expect(403);
  });

  test('credential is revocable and management audit never exposes its hash or secret', async () => {
    const created = await master(request(app).post('/api/v1/clients'))
      .send({ name: 'Revocable client', scopes: ['integrations:read'] })
      .expect(201);
    const credential = created.body.credential;
    const clientId = created.body.data.id;
    const client = (req) => req.set('Authorization', 'Bearer ' + credential);

    await client(request(app).get('/api/v1/integrations')).expect(200);
    const audit = await master(request(app).get('/api/v1/clients/' + clientId + '/audit')).expect(200);
    expect(audit.body.data.map((event) => event.action)).toContain('created');
    expect(audit.body.data.map((event) => event.action)).toContain('authenticated');
    expect(JSON.stringify(audit.body)).not.toContain(credential);

    const revoked = await master(request(app).post('/api/v1/clients/' + clientId + '/revoke')).expect(200);
    expect(revoked.body.data.revokedAt).toBeTruthy();
    expect(revoked.body.data).not.toHaveProperty('keyHash');
    await client(request(app).get('/api/v1/integrations')).expect(401);

    const clients = await master(request(app).get('/api/v1/clients')).expect(200);
    expect(clients.body.data.find((item) => item.id === clientId).revokedAt).toBeTruthy();
    expect(JSON.stringify(clients.body)).not.toContain(credential);
  });

  test('omitir integrationIds cria credencial sem acesso a recursos e null libera escopo global', async () => {
    const integration = await master(request(app).post('/api/v1/integrations'))
      .send(integrationBody('Scoped integration')).expect(201);
    await master(request(app).post('/api/v1/integrations/' + integration.body.data.id + '/activate')).expect(200);

    const restricted = await master(request(app).post('/api/v1/clients'))
      .send({ name: 'No integration access', scopes: ['integrations:read'] }).expect(201);
    const restrictedResponse = await request(app).get('/api/v1/integrations')
      .set('Authorization', 'Bearer ' + restricted.body.credential).expect(200);
    expect(restrictedResponse.body.data).toHaveLength(0);

    const global = await master(request(app).post('/api/v1/clients'))
      .send({ name: 'Global read client', scopes: ['integrations:read'], integrationIds: null }).expect(201);
    const globalResponse = await request(app).get('/api/v1/integrations')
      .set('Authorization', 'Bearer ' + global.body.credential).expect(200);
    expect(globalResponse.body.data.map((item) => item.id)).toContain(integration.body.data.id);
  });
});
