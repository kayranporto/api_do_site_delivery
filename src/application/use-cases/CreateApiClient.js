const ALLOWED_SCOPES = new Set([
  'integrations:read',
  'integrations:manage',
  'executions:read',
  'executions:write',
  'executions:reconcile',
  'observability:read'
]);

export class CreateApiClient {
  constructor({ apiClientRepository, idGenerator, clock, apiKeyGenerator }) {
    this.apiClientRepository = apiClientRepository;
    this.idGenerator = idGenerator;
    this.clock = clock;
    this.apiKeyGenerator = apiKeyGenerator;
  }

  async execute({ name, scopes, integrationIds = [] }) {
    if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 120) {
      throw new TypeError('name deve ter entre 2 e 120 caracteres.');
    }
    if (!Array.isArray(scopes) || scopes.length === 0 || scopes.some((scope) => !ALLOWED_SCOPES.has(scope))) {
      throw new TypeError('scopes contém permissões inválidas.');
    }
    if (new Set(scopes).size !== scopes.length) throw new TypeError('scopes não pode conter duplicatas.');
    if (integrationIds !== null && (!Array.isArray(integrationIds)
      || integrationIds.length > 500
      || integrationIds.some((id) => typeof id !== 'string' || !id.trim())
      || new Set(integrationIds).size !== integrationIds.length)) {
      throw new TypeError('integrationIds deve ser null ou uma lista única de identificadores válidos.');
    }

    const credential = this.apiKeyGenerator.generate();
    const now = this.clock.now();
    const client = await this.apiClientRepository.create({
      id: this.idGenerator.generate(),
      name: name.trim(),
      keyPrefix: credential.keyPrefix,
      keyHash: credential.keyHash,
      scopes: [...scopes],
      integrationIds: integrationIds === null ? null : [...integrationIds],
      createdAt: now,
      revokedAt: null,
      lastUsedAt: null
    });
    try {
      await this.apiClientRepository.recordAudit({
        clientId: client.id,
        action: 'created',
        requestId: null,
        createdAt: now
      });
    } catch { /* auditoria é best-effort; a credencial foi criada e será retornada uma única vez */ }
    return { client, credential: credential.key };
  }
}
