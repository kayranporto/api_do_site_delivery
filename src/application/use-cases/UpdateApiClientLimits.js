export class UpdateApiClientLimits {
  constructor({ apiClientRepository, clock }) {
    this.apiClientRepository = apiClientRepository;
    this.clock = clock;
  }

  async execute({ clientId, rateLimitMax, rateLimitWindowMs }) {
    if (rateLimitMax === undefined && rateLimitWindowMs === undefined) {
      throw new TypeError('Informe rateLimitMax, rateLimitWindowMs ou ambos.');
    }
    if (rateLimitMax !== undefined
      && (!Number.isInteger(rateLimitMax) || rateLimitMax < 1 || rateLimitMax > 100_000)) {
      throw new RangeError('rateLimitMax deve ficar entre 1 e 100000.');
    }
    if (rateLimitWindowMs !== undefined
      && (!Number.isInteger(rateLimitWindowMs) || rateLimitWindowMs < 1_000 || rateLimitWindowMs > 3_600_000)) {
      throw new RangeError('rateLimitWindowMs deve ficar entre 1000 e 3600000.');
    }

    const client = await this.apiClientRepository.updateLimits({
      clientId,
      rateLimitMax,
      rateLimitWindowMs
    });
    if (!client) return null;

    try {
      await this.apiClientRepository.recordAudit({
        clientId,
        action: 'limits_updated',
        requestId: null,
        createdAt: this.clock.now()
      });
    } catch {
      // A nova quota permanece aplicada mesmo se a auditoria estiver indisponível.
    }
    return client;
  }
}
