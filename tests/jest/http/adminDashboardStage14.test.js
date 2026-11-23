import { describe, expect, test } from '@jest/globals';
import request from 'supertest';
import { createContainer } from '../../../src/bootstrap/createContainer.js';
import { createHttpApp } from '../../../src/infrastructure/http/createHttpApp.js';

const MASTER_TOKEN = 'master-stage14-token-with-at-least-thirty-two-characters';

function setup() {
  const container = createContainer({ environment: {} });
  const history = [{
    timestamp: '2026-11-23T22:00:00.000Z',
    status: 'firing',
    code: 'HTTP_5XX_RATE_HIGH',
    severity: 'critical',
    observed: 10,
    threshold: 5,
    message: 'Taxa 5xx elevada.',
    instanceId: 'dashboard-test',
    windowMinutes: 5
  }];
  const alertMonitor = {
    async check() { return { status: 'ok', alerts: [] }; },
    start() { return false; },
    stop() { return false; },
    observe(value) { return value; },
    getHistory({ limit = 50 } = {}) { return history.slice(-limit).reverse().map((entry) => ({ ...entry })); }
  };
  const app = createHttpApp({
    useCases: container.useCases,
    apiAccessToken: MASTER_TOKEN,
    apiClientRepository: container.repositories.apiClientRepository,
    executionRepository: container.repositories.executionRepository,
    alertMonitor
  });
  return { app, container };
}

const master = (req) => req.set('Authorization', 'Bearer ' + MASTER_TOKEN);

describe('administrative dashboard', () => {
  test('/admin serves the dashboard without caching and with restrictive response headers', async () => {
    const { app } = setup();
    const page = await request(app).get('/admin').expect(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.headers['cache-control']).toBe('no-store');
    expect(page.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(page.headers['content-security-policy']).toContain("default-src 'self'");
    expect(page.text).toContain('Console administrativo');
    expect(page.text).toContain('/admin/assets/app.js');

    await request(app).get('/admin/assets/app.js').expect(200);
    await request(app).get('/admin/assets/styles.css').expect(200);
  });

  test('alert history is master-only and validates its requested length', async () => {
    const { app } = setup();
    await request(app).get('/api/v1/observability/alerts/history').expect(401);

    const valid = await master(request(app)
      .get('/api/v1/observability/alerts/history?limit=20')).expect(200);
    expect(valid.body.meta.retention).toBe('process_memory');
    expect(valid.body.data).toHaveLength(1);
    expect(valid.body.data[0].code).toBe('HTTP_5XX_RATE_HIGH');

    const invalid = await master(request(app)
      .get('/api/v1/observability/alerts/history?limit=101')).expect(400);
    expect(invalid.body.error.code).toBe('INVALID_ALERT_HISTORY_LIMIT');
  });

  test('dashboard exposes credential management UI while management APIs remain master-only', async () => {
    const { app } = setup();
    const page = await request(app).get('/admin').expect(200);
    expect(page.text).toContain('createClientForm');
    expect(page.text).toContain('limitsForm');
    expect(page.text).toContain('rotateForm');
    expect(page.text).toContain('credentialReveal');

    await request(app).post('/api/v1/clients').send({
      name: 'No master access',
      scopes: ['integrations:read']
    }).expect(401);
  });

  test('individual API credentials cannot read administrative alert history', async () => {
    const { app, container } = setup();
    const created = await master(request(app).post('/api/v1/clients')).send({
      name: 'Dashboard restricted client',
      scopes: ['observability:read'],
      integrationIds: null
    }).expect(201);

    await request(app).get('/api/v1/observability/alerts/history')
      .set('Authorization', 'Bearer ' + created.body.credential)
      .expect(403);
  });
});
