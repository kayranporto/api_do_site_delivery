import test from 'node:test';
import assert from 'node:assert/strict';
import { AlertMonitor } from '../../src/infrastructure/observability/AlertMonitor.js';
import { HttpMetrics } from '../../src/infrastructure/observability/HttpMetrics.js';
import { OperationalAlertEvaluator } from '../../src/infrastructure/observability/OperationalAlertEvaluator.js';
import { readFile } from 'node:fs/promises';
import { Script } from 'node:vm';

test('AlertMonitor registra firing e resolved sem exigir webhook', () => {
  let now = Date.UTC(2026, 10, 23, 22, 0, 0);
  const metrics = new HttpMetrics({ clock: () => now, instanceId: 'admin-dashboard-test' });
  const evaluator = new OperationalAlertEvaluator({
    minRequests: 1,
    p95LatencyMs: 60_000,
    errorRatePercent: 50,
    rateLimitRatePercent: 90,
    rssMb: 65_536
  });
  const monitor = new AlertMonitor({
    httpMetrics: metrics,
    alertEvaluator: evaluator,
    clock: () => now,
    historyLimit: 10
  });

  metrics.record({ timestamp: now, method: 'GET', route: '/example', statusCode: 503, durationMs: 120 });
  const firing = evaluator.evaluate(metrics.snapshot({ now }));
  monitor.observe(firing, now);
  assert.equal(monitor.getHistory()[0].status, 'firing');
  assert.equal(monitor.getHistory()[0].code, 'HTTP_5XX_RATE_HIGH');

  now += 5 * 60_000 + 1;
  const resolved = evaluator.evaluate(metrics.snapshot({ now }));
  monitor.observe(resolved, now);
  const history = monitor.getHistory({ limit: 10 });
  assert.equal(history[0].status, 'resolved');
  assert.equal(history[1].status, 'firing');
  assert.equal(monitor.getHistory({ limit: 1 }).length, 1);
  assert.throws(() => monitor.getHistory({ limit: 101 }), RangeError);
});

test('AlertMonitor limita o histórico e devolve cópias dos eventos', () => {
  const metrics = new HttpMetrics({ instanceId: 'history-capacity' });
  const monitor = new AlertMonitor({
    httpMetrics: metrics,
    alertEvaluator: new OperationalAlertEvaluator(),
    historyLimit: 10
  });
  const evaluation = {
    status: 'firing',
    generatedAt: new Date().toISOString(),
    instanceId: 'history-capacity',
    windowMinutes: 5,
    alerts: [{
      code: 'HTTP_5XX_RATE_HIGH',
      severity: 'critical',
      observed: 50,
      threshold: 5,
      message: 'Taxa 5xx elevada.'
    }]
  };
  for (let index = 0; index < 15; index += 1) {
    monitor.recordHistory({
      status: 'reminder',
      alert: evaluation.alerts[0],
      now: Date.UTC(2026, 10, 23, 22, index),
      evaluation
    });
  }
  assert.equal(monitor.getHistory({ limit: 100 }).length, 10);
  const entry = monitor.getHistory()[0];
  entry.code = 'tampered';
  assert.notEqual(monitor.getHistory()[0].code, 'tampered');
});

test('dashboard client script possui sintaxe válida e o HTML carrega somente assets locais', async () => {
  const scriptUrl = new URL('../../public/admin/assets/app.js', import.meta.url);
  const htmlUrl = new URL('../../public/admin/index.html', import.meta.url);
  const script = await readFile(scriptUrl, 'utf8');
  const html = await readFile(htmlUrl, 'utf8');
  assert.doesNotThrow(() => new Script(script));
  assert.match(html, /<script defer src="\/admin\/assets\/app\.js"><\/script>/);
  assert.match(html, /<link rel="stylesheet" href="\/admin\/assets\/styles\.css">/);
  assert.doesNotMatch(html, /<script[^>]*>[\s\S]*?<\/script>/);
});
