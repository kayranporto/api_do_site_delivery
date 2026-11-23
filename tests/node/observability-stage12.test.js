import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpMetrics } from '../../src/infrastructure/observability/HttpMetrics.js';
import { OperationalAlertEvaluator } from '../../src/infrastructure/observability/OperationalAlertEvaluator.js';
import { UpstashRedisRateLimitStore } from '../../src/infrastructure/rate-limits/UpstashRedisRateLimitStore.js';

test('HttpMetrics calcula percentis, taxas HTTP e métricas do processo', () => {
  let now = 1_800_000_000_000;
  const metrics = new HttpMetrics({
    clock: () => now,
    maxSamples: 100,
    instanceId: 'instance-test'
  });
  metrics.record({ timestamp: now - 1_000, method: 'get', route: '/health', statusCode: 200, durationMs: 10 });
  metrics.record({ timestamp: now - 500, method: 'get', route: '/clients/:clientId', statusCode: 429, durationMs: 20 });
  metrics.record({ timestamp: now - 100, method: 'post', route: '/operations', statusCode: 503, durationMs: 100 });

  const snapshot = metrics.snapshot({ windowMinutes: 5, now });
  assert.equal(snapshot.instanceId, 'instance-test');
  assert.equal(snapshot.totalRequests, 3);
  assert.equal(snapshot.serverErrors, 1);
  assert.equal(snapshot.clientErrors, 1);
  assert.equal(snapshot.rateLimited, 1);
  assert.equal(snapshot.errorRatePercent, 33.33);
  assert.equal(snapshot.rateLimitRatePercent, 33.33);
  assert.equal(snapshot.latencyMs.average, 43.33);
  assert.equal(snapshot.latencyMs.p50, 20);
  assert.equal(snapshot.latencyMs.p95, 100);
  assert.equal(snapshot.byStatus['503'], 1);
  assert.equal(snapshot.byRoute.find((route) => route.route === '/clients/:clientId').requests, 1);
  assert.ok(snapshot.process.memoryMb.rss > 0);
  assert.ok(snapshot.process.uptimeSeconds > 0);

  now += 10 * 60_000;
  assert.equal(metrics.snapshot({ windowMinutes: 5, now }).totalRequests, 0);
  assert.throws(() => metrics.snapshot({ windowMinutes: 61, now }), RangeError);
});

test('HttpMetrics limita a quantidade de amostras armazenadas', () => {
  const metrics = new HttpMetrics({ maxSamples: 100, instanceId: 'bounded' });
  for (let index = 0; index < 105; index += 1) {
    metrics.record({ method: 'GET', route: '/bounded', statusCode: 200, durationMs: index });
  }
  const snapshot = metrics.snapshot();
  assert.equal(snapshot.totalRequests, 100);
  assert.equal(snapshot.samplesEvicted, 5);
  assert.equal(snapshot.sampleCapacity, 100);
});

test('OperationalAlertEvaluator dispara alertas de latência, erros 5xx, 429 e RSS', () => {
  const evaluator = new OperationalAlertEvaluator({
    minRequests: 2,
    p95LatencyMs: 100,
    errorRatePercent: 25,
    rateLimitRatePercent: 25,
    rssMb: 1
  });
  const result = evaluator.evaluate({
    instanceId: 'instance-alert',
    generatedAt: new Date().toISOString(),
    windowMinutes: 5,
    totalRequests: 4,
    errorRatePercent: 25,
    rateLimitRatePercent: 25,
    latencyMs: { p95: 250 },
    process: { memoryMb: { rss: 2 } }
  });
  assert.equal(result.status, 'firing');
  assert.deepEqual(
    result.alerts.map((alert) => alert.code).sort(),
    ['HTTP_429_RATE_HIGH', 'HTTP_5XX_RATE_HIGH', 'HTTP_P95_LATENCY_HIGH', 'PROCESS_RSS_HIGH'].sort()
  );
});

test('OperationalAlertEvaluator não dispara taxa de erros com amostra abaixo do mínimo', () => {
  const evaluator = new OperationalAlertEvaluator({
    minRequests: 10,
    p95LatencyMs: 100,
    errorRatePercent: 5,
    rateLimitRatePercent: 20,
    rssMb: 65_536
  });
  const result = evaluator.evaluate({
    instanceId: 'instance-low-sample',
    generatedAt: new Date().toISOString(),
    windowMinutes: 5,
    totalRequests: 2,
    errorRatePercent: 100,
    rateLimitRatePercent: 0,
    latencyMs: { p95: 1_000 },
    process: { memoryMb: { rss: 10 } }
  });
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.alerts, []);
});

test('UpstashRedisRateLimitStore confirma readiness com PING', async () => {
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
