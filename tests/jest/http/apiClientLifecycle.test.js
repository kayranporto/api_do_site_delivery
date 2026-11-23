import { beforeEach, describe, expect, test } from '@jest/globals';
import request from 'supertest';
import { createContainer } from '../../../src/bootstrap/createContainer.js';
import { createHttpApp } from '../../../src/infrastructure/http/createHttpApp.js';

const MASTER_TOKEN = 'master-stage10-token-with-at-least-thirty-two-characters';

describe('API client lifecycle and quotas', () => {
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

  test('creates clients with individual expiry and quotas, then rate-limits each credential separately', async () => {
    const create = async (name) => master(request(app).post('/api/v1/clients')).send({
      name,
      scopes: ['integrations:read'],
      integrationIds: null,
      expiresInDays: 30,
      rateLimitMax: 1,
      rateLimitWindowMs: 60_000
    }).expect(201);

    const first = await create('Quota client A');
    const second = await create('Quota client B');
    expect(first.body.data.expiresAt).toBeTruthy();
    expect(first.body.data.rateLimitMax).toBe(1);
    expect(first.body.data.rateLimitWindowMs).toBe(60_000);

    const firstRequest = () => request(app).get('/api/v1/integrations')
      .set('Authorization', 'Bearer ' + first.body.credential);
    const secondRequest = () => request(app).get('/api/v1/integrations')
      .set('Authorization', 'Bearer ' + second.body.credential);

    await firstRequest().expect(200);
    const limited = await firstRequest().expect(429);
    expect(limited.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(limited.headers['retry-after']).toBeTruthy();
    await secondRequest().expect(200);
  });

  test('rotation invalidates the previous key immediately and returns the replacement once', async () => {
    const created = await master(request(app).post('/api/v1/clients')).send({
      name: 'Rotatable client',
      scopes: ['integrations:read'],
      integrationIds: null,
      expiresInDays: 2,
      rateLimitMax: 20,
      rateLimitWindowMs: 60_000
    }).expect(201);
    const oldKey = created.body.credential;
    const clientId = created.body.data.id;
    const callWith = (key) => request(app).get('/api/v1/integrations')
      .set('Authorization', 'Bearer ' + key);

    await callWith(oldKey).expect(200);
    const rotated = await master(request(app).post('/api/v1/clients/' + clientId + '/rotate'))
      .send({ expiresInDays: 45 }).expect(200);
    expect(rotated.body.meta.credentialShownOnce).toBe(true);
    expect(rotated.body.meta.previousCredentialInvalidated).toBe(true);
    expect(rotated.body.credential).not.toBe(oldKey);
    expect(rotated.body.data.expiresAt).not.toBe(created.body.data.expiresAt);
    expect(rotated.body.data.rateLimitMax).toBe(20);
    expect(rotated.body.data.rateLimitWindowMs).toBe(60_000);

    await callWith(oldKey).expect(401);
    await callWith(rotated.body.credential).expect(200);

    const audit = await master(request(app).get('/api/v1/clients/' + clientId + '/audit')).expect(200);
    expect(audit.body.data.map((event) => event.action)).toContain('rotated');
    expect(JSON.stringify(audit.body)).not.toContain(oldKey);
    expect(JSON.stringify(audit.body)).not.toContain(rotated.body.credential);
  });

  test('admin updates an individual quota without rotating the credential', async () => {
    const created = await master(request(app).post('/api/v1/clients')).send({
      name: 'Adjustable quota client',
      scopes: ['integrations:read'],
      integrationIds: null,
      rateLimitMax: 20,
      rateLimitWindowMs: 30_000
    }).expect(201);
    const clientId = created.body.data.id;

    const changed = await master(request(app).post('/api/v1/clients/' + clientId + '/limits'))
      .send({ rateLimitMax: 4 }).expect(200);
    expect(changed.body.data.rateLimitMax).toBe(4);
    expect(changed.body.data.rateLimitWindowMs).toBe(30_000);

    const changedWindow = await master(request(app).post('/api/v1/clients/' + clientId + '/limits'))
      .send({ rateLimitWindowMs: 5_000 }).expect(200);
    expect(changedWindow.body.data.rateLimitMax).toBe(4);
    expect(changedWindow.body.data.rateLimitWindowMs).toBe(5_000);

    const audit = await master(request(app).get('/api/v1/clients/' + clientId + '/audit')).expect(200);
    expect(audit.body.data.filter((event) => event.action === 'limits_updated')).toHaveLength(2);
    expect(audit.body.data.some((event) => event.action === 'rotated')).toBe(false);
  });

  test('expired individual credentials are rejected by HTTP authentication', async () => {
    const key = container.adapters.apiKeyGenerator.generate();
    await container.repositories.apiClientRepository.create({
      id: 'expired-http-client',
      name: 'Expired HTTP client',
      keyPrefix: key.keyPrefix,
      keyHash: key.keyHash,
      scopes: ['integrations:read'],
      integrationIds: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      expiresAt: new Date('2026-11-22T00:00:00.000Z'),
      rateLimitMax: 100,
      rateLimitWindowMs: 60_000
    });
    await request(app).get('/api/v1/integrations')
      .set('Authorization', 'Bearer ' + key.key).expect(401);
  });

  test('rejects invalid individual quota values and only master can rotate keys', async () => {
    const invalid = await master(request(app).post('/api/v1/clients')).send({
      name: 'Invalid quota',
      scopes: ['integrations:read'],
      rateLimitMax: 0
    }).expect(400);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');

    const created = await master(request(app).post('/api/v1/clients')).send({
      name: 'Master only rotate',
      scopes: ['integrations:read']
    }).expect(201);
    await request(app).post('/api/v1/clients/' + created.body.data.id + '/rotate')
      .send({}).expect(401);
  });
});
