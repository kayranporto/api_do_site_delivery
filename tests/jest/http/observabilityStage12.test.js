import { describe, expect, test } from '@jest/globals';
import request from 'supertest';
import { createContainer } from '../../../src/bootstrap/createContainer.js';
import { createHttpApp } from '../../../src/infrastructure/http/createHttpApp.js';
import { HttpMetrics } from '../../../src/infrastructure/observability/HttpMetrics.js';

const MASTER_TOKEN = 'master-stage12-token-with-at-least-thirty-two-characters';
const master = (req) => req.set('Authorization', 'Bearer ' + MASTER_TOKEN);

function makeApp(options = {}) {
  const container = createContainer({ environment: {} });
  const app = createHttpApp({
    useCases: container.useCases,
    apiAccessToken: MASTER_TOKEN,
    apiClientRepository: container.repositories.apiClientRepository,
    executionRepository: container.repositories.executionRepository,
    ...options
  });
  return { app, container };
}

describe('advanced HTTP observability', () => {
  test('health and readiness expose dependency state without leaking exception details', async () => {
    const { app } = makeApp({
      readinessChecks: {
        postgres: async () => false,
        worker: async () => { throw new Error('private connection string'); }
      }
    });

    await request(app).get('/health').expect(200);
    const ready = await request(app).get('/readyz').expect(503);
    expect(ready.body).toEqual({
      status: 'not_ready',
      checks: {
        postgres: 'unavailable',
        worker: 'unavailable',
        rateLimitStore: 'ok'
      }
    });
    expect(JSON.stringify(ready.body)).not.toContain('private connection string');
  });

  test('performance endpoint reports HTTP metrics and requires global observability scope', async () => {
    const { app } = makeApp({
      readinessChecks: { postgres: async () => true }
    });

    await request(app).get('/health').expect(200);
    await request(app).get('/readyz').expect(200);
    await request(app).get('/api/v1/observability/performance').expect(401);

    const client = await master(request(app).post('/api/v1/clients')).send({
      name: 'Restricted observability client',
      scopes: ['observability:read'],
      integrationIds: [],
      rateLimitMax: 20,
      rateLimitWindowMs: 60_000
    }).expect(201);
    await master(request(app)
      .get('/api/v1/clients/' + client.body.data.id + '/usage?days=1')).expect(200);

    const response = await master(request(app)
      .get('/api/v1/observability/performance?windowMinutes=5')).expect(200);
    expect(response.body.data.totalRequests).toBeGreaterThanOrEqual(5);
    expect(response.body.data.windowMinutes).toBe(5);
    expect(response.body.data.latencyMs.p95).toBeGreaterThanOrEqual(0);
    expect(response.body.data.process.memoryMb.rss).toBeGreaterThan(0);
    expect(response.body.data.byRoute.some((item) => item.route === '/health')).toBe(true);
    expect(response.body.data.byRoute.some((item) => item.route === '/clients/:clientId/usage')).toBe(true);
    expect(response.body.data.byStatus['401']).toBe(1);
    expect(JSON.stringify(response.body)).not.toContain(MASTER_TOKEN);
    expect(JSON.stringify(response.body)).not.toContain(client.body.data.id);

    await request(app).get('/api/v1/observability/performance')
      .set('Authorization', 'Bearer ' + client.body.credential)
      .expect(403);
  });

  test('alerts endpoint avalia regras configuradas e rejeita janela inválida', async () => {
    const httpMetrics = new HttpMetrics({ instanceId: 'alerts-test' });
    httpMetrics.record({
      method: 'GET',
      route: '/example',
      statusCode: 500,
      durationMs: 250
    });
    httpMetrics.record({
      method: 'GET',
      route: '/example',
      statusCode: 429,
      durationMs: 250
    });
    const { app } = makeApp({
      httpMetrics,
      alertThresholds: {
        minRequests: 1,
        p95LatencyMs: 100,
        errorRatePercent: 25,
        rateLimitRatePercent: 25,
        rssMb: 65_536
      }
    });

    await request(app).get('/api/v1/observability/alerts').expect(401);
    const response = await master(request(app)
      .get('/api/v1/observability/alerts?windowMinutes=5')).expect(200);
    expect(response.body.data.status).toBe('firing');
    expect(response.body.data.alerts.map((item) => item.code)).toEqual(expect.arrayContaining([
      'HTTP_P95_LATENCY_HIGH',
      'HTTP_5XX_RATE_HIGH',
      'HTTP_429_RATE_HIGH'
    ]));

    const invalid = await master(request(app)
      .get('/api/v1/observability/alerts?windowMinutes=61')).expect(400);
    expect(invalid.body.error.code).toBe('INVALID_PERFORMANCE_WINDOW');
  });
});
