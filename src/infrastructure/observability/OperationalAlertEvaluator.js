/** Avalia limites operacionais locais; não envia notificações externas. */
export class OperationalAlertEvaluator {
  constructor({
    minRequests = 20,
    p95LatencyMs = 1_000,
    errorRatePercent = 5,
    rateLimitRatePercent = 20,
    rssMb = 512
  } = {}) {
    for (const [name, value, min, max] of [
      ['minRequests', minRequests, 1, 100_000],
      ['p95LatencyMs', p95LatencyMs, 1, 60_000],
      ['errorRatePercent', errorRatePercent, 1, 100],
      ['rateLimitRatePercent', rateLimitRatePercent, 1, 100],
      ['rssMb', rssMb, 1, 65_536]
    ]) {
      if (!Number.isInteger(value) || value < min || value > max) {
        throw new RangeError(name + ' fora do intervalo permitido.');
      }
    }
    this.thresholds = { minRequests, p95LatencyMs, errorRatePercent, rateLimitRatePercent, rssMb };
  }

  evaluate(snapshot) {
    if (!snapshot || typeof snapshot !== 'object' || !snapshot.latencyMs || !snapshot.process?.memoryMb) {
      throw new TypeError('Snapshot de desempenho inválido.');
    }

    const alerts = [];
    const { minRequests, p95LatencyMs, errorRatePercent, rateLimitRatePercent, rssMb } = this.thresholds;
    if (snapshot.totalRequests >= minRequests && snapshot.latencyMs.p95 >= p95LatencyMs) {
      alerts.push({
        code: 'HTTP_P95_LATENCY_HIGH',
        severity: 'warning',
        observed: snapshot.latencyMs.p95,
        threshold: p95LatencyMs,
        message: 'O percentil 95 da latência HTTP excedeu o limite configurado.'
      });
    }
    if (snapshot.totalRequests >= minRequests && snapshot.errorRatePercent >= errorRatePercent) {
      alerts.push({
        code: 'HTTP_5XX_RATE_HIGH',
        severity: 'critical',
        observed: snapshot.errorRatePercent,
        threshold: errorRatePercent,
        message: 'A proporção de respostas HTTP 5xx excedeu o limite configurado.'
      });
    }
    if (snapshot.totalRequests >= minRequests && snapshot.rateLimitRatePercent >= rateLimitRatePercent) {
      alerts.push({
        code: 'HTTP_429_RATE_HIGH',
        severity: 'warning',
        observed: snapshot.rateLimitRatePercent,
        threshold: rateLimitRatePercent,
        message: 'A proporção de respostas HTTP 429 excedeu o limite configurado.'
      });
    }
    if (snapshot.process.memoryMb.rss >= rssMb) {
      alerts.push({
        code: 'PROCESS_RSS_HIGH',
        severity: 'warning',
        observed: snapshot.process.memoryMb.rss,
        threshold: rssMb,
        message: 'O consumo de memória RSS do processo excedeu o limite configurado.'
      });
    }

    return {
      status: alerts.length ? 'firing' : 'ok',
      generatedAt: snapshot.generatedAt,
      instanceId: snapshot.instanceId,
      windowMinutes: snapshot.windowMinutes,
      evaluatedRequests: snapshot.totalRequests,
      thresholds: { ...this.thresholds },
      alerts
    };
  }
}
