import { describe, expect, test } from '@jest/globals';
import request from 'supertest';
import { createContainer } from '../../../src/bootstrap/createContainer.js';
import { createHttpApp } from '../../../src/infrastructure/http/createHttpApp.js';
import { HttpMetrics } from '../../../src/infrastructure/observability/HttpMetrics.js';

const MASTER_TOKEN = 'master-stage13-token-with-at-least-thirty-two-characters';
const METRICS_TOKEN = 'metrics-stage13-token-with-at-least-thirty-two-characters';

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

describe('Prometheus scraping and centralized alert monitor', () => {
  test('/metrics exige token de scraping dedicado e exporta exposition Prometheus', async () => {
    const httpMetrics = new HttpMetrics({ instanceId: 'prometheus-test' });
    httpMetrics.record({
      method: 'GET',
      route: '/health',
      statusCode: 200,
      durationMs: 12
    });
    const { app } = makeApp({
      httpMetrics,
      metricsAccessToken: METRICS_TOKEN
    });

    await request(app).get('/metrics').expect(401);
    await request(app).get('/metrics')
      .set('Authorization', 'Bearer ' + MASTER_TOKEN)
      .expect(401);

    const scraped = await request(app).get('/metrics')
      .set('Authorization', 'Bearer ' + METRICS_TOKEN)
      .expect(200);
    expect(scraped.headers['content-type']).toContain('text/plain');
    expect(scraped.headers['cache-control']).toBe('no-store');
    expect(scraped.text).toContain('# TYPE api_http_requests_in_window gauge');
    expect(scraped.text).toMatch(/api_http_requests_in_window [1-9][0-9]*/);
    expect(scraped.text).toContain('api_process_info{instance_id="prometheus-test"} 1');
    expect(scraped.text).not.toContain(MASTER_TOKEN);
    expect(scraped.text).not.toContain(METRICS_TOKEN);
  });

  test('/metrics permanece desabilitado quando não há token de scraping configurado', async () => {
    const { app } = makeApp();
    await request(app).get('/metrics').expect(404);
  });

  test('monitor agenda alertas apenas quando webhook está configurado e pode ser encerrado', () => {
    const { app } = makeApp({
      alertNotifier: { async notify() {} },
      alertNotificationIntervalMs: 5_000,
      alertNotificationCooldownMs: 10_000
    });
    const monitor = app.locals.alertMonitor;
    expect(monitor.start()).toBe(true);
    expect(monitor.start()).toBe(false);
    expect(monitor.stop()).toBe(true);
    expect(monitor.stop()).toBe(false);
  });
});
