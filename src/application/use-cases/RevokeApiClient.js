export class RevokeApiClient {
  constructor({ apiClientRepository, clock }) {
    this.apiClientRepository = apiClientRepository;
    this.clock = clock;
  }
  async execute({ clientId }) {
    const revokedAt = this.clock.now();
    const client = await this.apiClientRepository.revoke(clientId, revokedAt);
    if (!client) return null;
    try {
      await this.apiClientRepository.recordAudit({
        clientId,
        action: 'revoked',
        requestId: null,
        createdAt: revokedAt
      });
    } catch { /* a revogação deve permanecer efetiva mesmo se a auditoria falhar */ }
    return client;
  }
}
