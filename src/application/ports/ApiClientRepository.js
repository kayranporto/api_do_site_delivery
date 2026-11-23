/** Porta de persistência para credenciais de clientes da API. */
export class ApiClientRepository {
  async create(_client) { throw new Error('ApiClientRepository.create deve ser implementado.'); }
  async findActiveByPrefix(_keyPrefix) { throw new Error('ApiClientRepository.findActiveByPrefix deve ser implementado.'); }
  async rotateCredential(_input) { throw new Error('ApiClientRepository.rotateCredential deve ser implementado.'); }
  async updateLimits(_input) { throw new Error('ApiClientRepository.updateLimits deve ser implementado.'); }
  async revoke(_clientId, _revokedAt) { throw new Error('ApiClientRepository.revoke deve ser implementado.'); }
  async list() { throw new Error('ApiClientRepository.list deve ser implementado.'); }
  async recordAudit(_event) { throw new Error('ApiClientRepository.recordAudit deve ser implementado.'); }
  async listAudit(_clientId, _limit) { throw new Error('ApiClientRepository.listAudit deve ser implementado.'); }
}
