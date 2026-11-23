/** Envia eventos de alerta para um webhook HTTPS configurado pelo operador. */
export class WebhookAlertNotifier {
  constructor({ url, token = null, fetchImpl = globalThis.fetch, timeoutMs = 5_000 } = {}) {
    let parsed;
    try { parsed = new URL(url); } catch { throw new Error('ALERT_WEBHOOK_URL deve ser uma URL HTTPS válida.'); }
    if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password || parsed.hash) {
      throw new Error('ALERT_WEBHOOK_URL deve usar HTTPS, sem credenciais embutidas ou fragmento.');
    }
    if (token !== null && (typeof token !== 'string' || token.length < 16)) {
      throw new Error('ALERT_WEBHOOK_TOKEN deve ter pelo menos 16 caracteres.');
    }
    if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl deve ser uma função.');
    if (!Number.isInteger(timeoutMs) || timeoutMs < 500 || timeoutMs > 30_000) {
      throw new RangeError('timeoutMs deve estar entre 500 e 30000.');
    }
    this.url = parsed.toString();
    this.token = token;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async notify(event) {
    if (!event || !['firing', 'resolved'].includes(event.status)
      || !Array.isArray(event.alerts) || !Array.isArray(event.resolved)) {
      throw new TypeError('Evento de alerta inválido.');
    }

    const payload = {
      event: 'generic_integration_api.alerts',
      status: event.status,
      generatedAt: event.generatedAt,
      instanceId: event.instanceId,
      windowMinutes: event.windowMinutes,
      alerts: event.alerts.map((alert) => ({
        code: alert.code,
        severity: alert.severity,
        observed: alert.observed,
        threshold: alert.threshold,
        message: alert.message
      })),
      resolved: event.resolved.map((alert) => ({
        code: alert.code,
        severity: alert.severity
      }))
    };

    const headers = { 'content-type': 'application/json' };
    if (this.token) headers.authorization = 'Bearer ' + this.token;

    let response;
    try {
      response = await this.fetchImpl(this.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        redirect: 'error',
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (error) {
      throw new Error('Não foi possível entregar o alerta ao webhook configurado.', { cause: error });
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new Error('O webhook configurado recusou o evento de alerta.');
    }
    await response.body?.cancel().catch(() => {});
    return { delivered: true, status: response.status };
  }
}
