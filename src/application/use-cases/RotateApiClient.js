export class RotateApiClient {
  constructor({ apiClientRepository, clock, apiKeyGenerator }) {
    this.apiClientRepository = apiClientRepository;
    this.clock = clock;
    this.apiKeyGenerator = apiKeyGenerator;
  }

  async execute({ clientId, expiresInDays = 90 }) {
    if (!Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 3650) {
      throw new RangeError('expiresInDays deve ficar entre 1 e 3650.');
    }

    const credential = this.apiKeyGenerator.generate();
    const rotatedAt = this.clock.now();
    const expiresAt = new Date(rotatedAt.getTime() + expiresInDays * 24 * 60 * 60 * 1000);
    const client = await this.apiClientRepository.rotateCredential({
      clientId,
      keyPrefix: credential.keyPrefix,
      keyHash: credential.keyHash,
      expiresAt,
      rotatedAt
    });
    if (!client) return null;

    try {
      await this.apiClientRepository.recordAudit({
        clientId,
        action: 'rotated',
        requestId: null,
        createdAt: rotatedAt
      });
    } catch {
      // A nova chave já substituiu a anterior; falha de auditoria não desfaz a rotação.
    }
    return { client, credential: credential.key };
  }
}
