import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPrometheusMetrics } from '../../src/infrastructure/observability/PrometheusMetricsExporter.js';
import { WebhookAlertNotifier } from '../../src/infrastructure/observability/WebhookAlertNotifier.js';
import { AlertMonitor } from '../../src/infrastructure/observability/AlertMonitor.js';
import { HttpMetrics } from '../../src/infrastructure/observability/HttpMetrics.js';
import { OperationalAlertEvaluator } from '../../src/infrastructure/observability/OperationalAlertEvaluator.js';
import { UpstashRedisRateLimitStore } from '../../src/infrastructure/rate-limits/UpstashRedisRateLimitStore.js';

function snapshot({ generatedAt = '2026-11-23T22:00:00.000Z' } = {}) {
  return {
    instanceId: 'api-instance-1',
    generatedAt,
    windowMinutes: 5,
    totalRequests: 4,
    serverErrors: 1,
    clientErrors: 1,
    rateLimited: 1,
    errorRatePercent: 25,
    rateLimitRatePercent: 25,
    latencyMs: { average: 32, p50: 20, p95: 90, max: 140 },
    byStatus: { 200: 2, 429: 1, 503: 1 },
    byRoute: [
      { method: 'GET', route: '/clients/:clientId/usage', requests: 2 },
      { method: 'POST', route: '/operations', requests: 2 }
    ],
    process: {
      uptimeSeconds: 500,
      cpuPercent: 1.2,
      memoryBytes: { rss: 50_000, heapUsed: 20_000, heapTotal: 40_000, external: 1_000, arrayBuffers: 500 }
    }
  };
}

test('Prometheus exporter gera exposition 0.0.4 com labels escapados e métricas de processo', () => {
  const output = renderPrometheusMetrics(snapshot());
  assert.match(output, /# TYPE api_http_requests_in_window gauge/);
  assert.match(output, /api_http_requests_in_window 4/);
  assert.match(output, /api_http_latency_ms\{quantile="0.95"\} 90/);
  assert.match(output, /api_http_route_requests_in_window\{method="GET",route="\/clients\/:clientId\/usage"\} 2/);
  assert.match(output, /api_process_memory_bytes\{kind="rss"\} 50000/);
  assert.match(output, /api_process_info\{instance_id="api-instance-1"\} 1/);
  assert.ok(output.endsWith('\n'));
});

test('WebhookAlertNotifier envia payload mínimo, não segue redirects e usa token apenas no header', async () => {
  let sent;
  const notifier = new WebhookAlertNotifier({
    url: 'https://alerts.example.test/hook/secret-path',
    token: 'webhook-auth-token-long-enough',
    fetchImpl: async (url, options) => {
      sent = { url, options, body: JSON.parse(options.body) };
      return { ok: true, status: 204 };
    }
  });
  const result = await notifier.notify({
    status: 'firing',
    generatedAt: '2026-11-23T22:00:00.000Z',
    instanceId: 'api-1',
    windowMinutes: 5,
    alerts: [{
      code: 'HTTP_5XX_RATE_HIGH',
      severity: 'critical',
      observed: 10,
      threshold: 5,
      message: 'Taxa 5xx elevada.',
      rawError: 'must-not-be-forwarded'
    }],
    resolved: []
  });

  assert.equal(result.delivered, true);
  assert.equal(sent.url, 'https://alerts.example.test/hook/secret-path');
  assert.equal(sent.options.method, 'POST');
  assert.equal(sent.options.redirect, 'error');
  assert.equal(sent.options.headers.authorization, 'Bearer webhook-auth-token-long-enough');
  assert.equal(sent.body.event, 'generic_integration_api.alerts');
  assert.equal(sent.body.alerts[0].code, 'HTTP_5XX_RATE_HIGH');
  assert.equal(JSON.stringify(sent.body).includes('must-not-be-forwarded'), false);
  assert.equal(JSON.stringify(sent.body).includes('webhook-auth-token'), false);
  assert.ok(sent.options.signal instanceof AbortSignal);
});

test('WebhookAlertNotifier exige HTTPS e falha sem esconder o status de entrega', async () => {
  assert.throws(() => new WebhookAlertNotifier({
    url: 'http://alerts.example.test/hook',
    fetchImpl: async () => ({ ok: true })
  }), /deve usar HTTPS/);

  const failing = new WebhookAlertNotifier({
    url: 'https://alerts.example.test/hook',
    fetchImpl: async () => ({ ok: false, status: 503 })
  });
  await assert.rejects(() => failing.notify({
    status: 'firing',
    generatedAt: new Date().toISOString(),
    instanceId: 'test',
    windowMinutes: 5,
    alerts: [],
    resolved: []
  }), /recusou o evento/);
});

test('AlertMonitor deduplica alertas, envia lembrete após cooldown e notifica recuperação', async () => {
  let now = Date.UTC(2026, 10, 23, 22, 0, 0);
  const metrics = new HttpMetrics({ clock: () => now, instanceId: 'monitor-test' });
  metrics.record({ timestamp: now, method: 'GET', route: '/unstable', statusCode: 503, durationMs: 100 });
  metrics.record({ timestamp: now, method: 'GET', route: '/unstable', statusCode: 503, durationMs: 120 });
  const evaluator = new OperationalAlertEvaluator({
    minRequests: 1,
    p95LatencyMs: 60_000,
    errorRatePercent: 5,
    rateLimitRatePercent: 90,
    rssMb: 65_536
  });
  const events = [];
  const monitor = new AlertMonitor({
    httpMetrics: metrics,
    alertEvaluator: evaluator,
    notifier: { async notify(event) { events.push(event); } },
    windowMinutes: 5,
    intervalMs: 5_000,
    cooldownMs: 10_000,
    clock: () => now
  });

  const first = await monitor.check();
  assert.equal(first.status, 'firing');
  assert.equal(events.length, 1);
  assert.equal(events[0].status, 'firing');
  assert.equal(events[0].alerts[0].code, 'HTTP_5XX_RATE_HIGH');

  await monitor.check();
  assert.equal(events.length, 1);

  now += 10_001;
  await monitor.check();
  assert.equal(events.length, 2);
  assert.equal(events[1].status, 'firing');

  now += 5 * 60_000 + 1;
  const recovered = await monitor.check();
  assert.equal(recovered.status, 'ok');
  assert.equal(events.length, 3);
  assert.equal(events[2].status, 'resolved');
  assert.deepEqual(events[2].resolved.map((item) => item.code), ['HTTP_5XX_RATE_HIGH']);
});

test('AlertMonitor não inicia agendamento sem notifier e permite parar o timer', () => {
  const monitor = new AlertMonitor({
    httpMetrics: new HttpMetrics(),
    alertEvaluator: new OperationalAlertEvaluator()
  });
  assert.equal(monitor.start(), false);
  assert.equal(monitor.stop(), false);

  const active = new AlertMonitor({
    httpMetrics: new HttpMetrics(),
    alertEvaluator: new OperationalAlertEvaluator(),
    notifier: { async notify() {} }
  });
  assert.equal(active.start(), true);
  assert.equal(active.start(), false);
  assert.equal(active.stop(), true);
  assert.equal(active.stop(), false);
});

test('Upstash Redis responde ao readiness ping por meio da API REST', async () => {
  const store = new UpstashRedisRateLimitStore({
    url: 'https://redis.example.test',
    token: 'upstash-rest-token-with-sufficient-length',
    fetchImpl: async (_url, options) => {
      assert.deepEqual(JSON.parse(options.body), ['PING']);
      return { ok: true, async json() { return { result: 'PONG' }; } };
    }
  });
  assert.equal(await store.ping(), true);
});
