/** Avalia alertas periodicamente e deduplica notificações até a recuperação. */
export class AlertMonitor {
  constructor({
    httpMetrics,
    alertEvaluator,
    notifier = null,
    windowMinutes = 5,
    intervalMs = 60_000,
    cooldownMs = 300_000,
    clock = Date.now,
    onError = () => {}
  } = {}) {
    if (!httpMetrics || typeof httpMetrics.snapshot !== 'function') {
      throw new TypeError('httpMetrics deve implementar snapshot().');
    }
    if (!alertEvaluator || typeof alertEvaluator.evaluate !== 'function') {
      throw new TypeError('alertEvaluator deve implementar evaluate().');
    }
    if (notifier !== null && typeof notifier.notify !== 'function') {
      throw new TypeError('notifier deve implementar notify().');
    }
    if (!Number.isInteger(windowMinutes) || windowMinutes < 1 || windowMinutes > 60) {
      throw new RangeError('windowMinutes deve estar entre 1 e 60.');
    }
    if (!Number.isInteger(intervalMs) || intervalMs < 5_000 || intervalMs > 3_600_000) {
      throw new RangeError('intervalMs deve estar entre 5000 e 3600000.');
    }
    if (!Number.isInteger(cooldownMs) || cooldownMs < 10_000 || cooldownMs > 86_400_000) {
      throw new RangeError('cooldownMs deve estar entre 10000 e 86400000.');
    }
    if (typeof clock !== 'function' || typeof onError !== 'function') {
      throw new TypeError('clock e onError devem ser funções.');
    }

    this.httpMetrics = httpMetrics;
    this.alertEvaluator = alertEvaluator;
    this.notifier = notifier;
    this.windowMinutes = windowMinutes;
    this.intervalMs = intervalMs;
    this.cooldownMs = cooldownMs;
    this.clock = clock;
    this.onError = onError;
    this.activeAlerts = new Map();
    this.lastNotifiedAt = new Map();
    this.timer = null;
    this.inFlight = null;
  }

  async check() {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.performCheck();
    try {
      return await this.inFlight;
    } finally {
      this.inFlight = null;
    }
  }

  async performCheck() {
    const now = this.clock();
    const snapshot = this.httpMetrics.snapshot({
      windowMinutes: this.windowMinutes,
      now
    });
    const evaluation = this.alertEvaluator.evaluate(snapshot);
    if (!this.notifier) return evaluation;

    const current = new Map(evaluation.alerts.map((alert) => [alert.code, alert]));
    const due = [];
    for (const alert of current.values()) {
      const lastNotified = this.lastNotifiedAt.get(alert.code);
      if (lastNotified === undefined || now - lastNotified >= this.cooldownMs) due.push(alert);
    }
    const resolved = [...this.activeAlerts.values()]
      .filter((alert) => !current.has(alert.code))
      .map((alert) => ({ code: alert.code, severity: alert.severity }));

    if (due.length > 0 || resolved.length > 0) {
      await this.notifier.notify({
        status: current.size > 0 ? 'firing' : 'resolved',
        generatedAt: evaluation.generatedAt,
        instanceId: evaluation.instanceId,
        windowMinutes: evaluation.windowMinutes,
        alerts: due,
        resolved
      });
      for (const alert of due) this.lastNotifiedAt.set(alert.code, now);
      for (const alert of resolved) this.lastNotifiedAt.delete(alert.code);
    }

    this.activeAlerts = current;
    return evaluation;
  }

  start() {
    if (!this.notifier || this.timer) return false;
    const run = () => {
      this.check().catch(() => {
        try { this.onError(); } catch { /* logging não pode interromper o monitor */ }
      });
    };
    run();
    this.timer = setInterval(run, this.intervalMs);
    this.timer.unref?.();
    return true;
  }

  stop() {
    if (!this.timer) return false;
    clearInterval(this.timer);
    this.timer = null;
    return true;
  }
}
