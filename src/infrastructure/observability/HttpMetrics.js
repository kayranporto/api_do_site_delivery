import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

function percentile(sorted, percent) {
  if (sorted.length === 0) return 0;
  const index = Math.max(0, Math.ceil((percent / 100) * sorted.length) - 1);
  return Math.round(sorted[index] * 100) / 100;
}

function percentage(part, total) {
  return total === 0 ? 0 : Math.round((part / total) * 10_000) / 100;
}

function routeLabel(req) {
  if (typeof req.route?.path === 'string') {
    const route = String(req.route.path);
    return route.length > 120 ? '_route_overflow' : route;
  }
  return req.path === '/health' || req.path === '/readyz' ? req.path : '_unmatched';
}

/** Métricas HTTP limitadas à instância, sem armazenar payload, query, IP ou credenciais. */
export class HttpMetrics {
  constructor({ clock = Date.now, maxSamples = 10_000, instanceId = randomUUID() } = {}) {
    if (typeof clock !== 'function') throw new TypeError('clock deve ser uma função.');
    if (!Number.isInteger(maxSamples) || maxSamples < 100 || maxSamples > 100_000) {
      throw new RangeError('maxSamples deve estar entre 100 e 100000.');
    }
    if (typeof instanceId !== 'string' || !instanceId || instanceId.length > 80) {
      throw new TypeError('instanceId deve ser uma string não vazia de até 80 caracteres.');
    }
    this.clock = clock;
    this.maxSamples = maxSamples;
    this.instanceId = instanceId;
    this.samples = [];
    this.samplesEvicted = 0;
  }

  middleware() {
    return (req, res, next) => {
      const startedAt = performance.now();
      res.once('finish', () => {
        this.record({
          timestamp: this.clock(),
          method: req.method,
          route: routeLabel(req),
          statusCode: res.statusCode,
          durationMs: Math.max(0, performance.now() - startedAt)
        });
      });
      next();
    };
  }

  record({ timestamp = this.clock(), method = 'UNKNOWN', route = '_unmatched', statusCode = 200, durationMs = 0 } = {}) {
    if (!Number.isFinite(timestamp) || !Number.isInteger(statusCode)
      || statusCode < 100 || statusCode > 599
      || !Number.isFinite(durationMs) || durationMs < 0) {
      throw new TypeError('Amostra HTTP inválida.');
    }
    const safeMethod = typeof method === 'string' && /^[A-Z]{1,10}$/i.test(method)
      ? method.toUpperCase()
      : 'UNKNOWN';
    const safeRoute = typeof route === 'string' && route.length > 0
      ? route.slice(0, 120)
      : '_unmatched';

    this.samples.push({
      timestamp,
      method: safeMethod,
      route: safeRoute,
      statusCode,
      durationMs
    });
    if (this.samples.length > this.maxSamples) {
      const removeCount = this.samples.length - this.maxSamples;
      this.samples.splice(0, removeCount);
      this.samplesEvicted += removeCount;
    }
  }

  snapshot({ windowMinutes = 5, now = this.clock() } = {}) {
    if (!Number.isInteger(windowMinutes) || windowMinutes < 1 || windowMinutes > 60) {
      throw new RangeError('windowMinutes deve ficar entre 1 e 60.');
    }
    if (!Number.isFinite(now)) throw new TypeError('now deve ser um timestamp válido.');

    const since = now - windowMinutes * 60_000;
    const samples = this.samples.filter((sample) => sample.timestamp >= since && sample.timestamp <= now);
    const durations = samples.map((sample) => sample.durationMs).sort((a, b) => a - b);
    const totalRequests = samples.length;
    const serverErrors = samples.filter((sample) => sample.statusCode >= 500).length;
    const clientErrors = samples.filter((sample) => sample.statusCode >= 400 && sample.statusCode < 500).length;
    const rateLimited = samples.filter((sample) => sample.statusCode === 429).length;
    const statusCounts = {};
    const routeCounts = new Map();

    for (const sample of samples) {
      const status = String(sample.statusCode);
      statusCounts[status] = (statusCounts[status] ?? 0) + 1;
      const key = sample.method + ' ' + sample.route;
      const previous = routeCounts.get(key) ?? { method: sample.method, route: sample.route, requests: 0, errors5xx: 0, totalDurationMs: 0 };
      previous.requests += 1;
      if (sample.statusCode >= 500) previous.errors5xx += 1;
      previous.totalDurationMs += sample.durationMs;
      routeCounts.set(key, previous);
    }

    const byRoute = [...routeCounts.values()]
      .map((route) => ({
        method: route.method,
        route: route.route,
        requests: route.requests,
        errors5xx: route.errors5xx,
        averageLatencyMs: Math.round((route.totalDurationMs / route.requests) * 100) / 100
      }))
      .sort((a, b) => b.requests - a.requests)
      .slice(0, 20);

    const memory = process.memoryUsage();
    const cpu = process.cpuUsage();
    const uptimeSeconds = process.uptime();
    const cpuPercent = uptimeSeconds > 0
      ? Math.round((((cpu.user + cpu.system) / 1_000_000) / uptimeSeconds) * 10_000) / 100
      : 0;

    return {
      instanceId: this.instanceId,
      generatedAt: new Date(now).toISOString(),
      windowMinutes,
      totalRequests,
      serverErrors,
      clientErrors,
      rateLimited,
      errorRatePercent: percentage(serverErrors, totalRequests),
      rateLimitRatePercent: percentage(rateLimited, totalRequests),
      latencyMs: {
        average: totalRequests === 0 ? 0 : Math.round((durations.reduce((sum, value) => sum + value, 0) / totalRequests) * 100) / 100,
        p50: percentile(durations, 50),
        p95: percentile(durations, 95),
        max: durations.length ? Math.round(durations[durations.length - 1] * 100) / 100 : 0
      },
      byStatus: statusCounts,
      byRoute,
      process: {
        pid: process.pid,
        uptimeSeconds: Math.round(uptimeSeconds * 100) / 100,
        cpuPercent,
        memoryBytes: {
          rss: memory.rss,
          heapUsed: memory.heapUsed,
          heapTotal: memory.heapTotal,
          external: memory.external,
          arrayBuffers: memory.arrayBuffers
        },
        memoryMb: {
          rss: Math.round((memory.rss / 1_048_576) * 100) / 100,
          heapUsed: Math.round((memory.heapUsed / 1_048_576) * 100) / 100,
          heapTotal: Math.round((memory.heapTotal / 1_048_576) * 100) / 100
        }
      },
      sampleCapacity: this.maxSamples,
      samplesEvicted: this.samplesEvicted
    };
  }
}
