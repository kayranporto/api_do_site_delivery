export class ListApiClientAudit {
  constructor({ apiClientRepository }) { this.apiClientRepository = apiClientRepository; }
  async execute({ clientId, limit = 100 }) {
    return this.apiClientRepository.listAudit(clientId, limit);
  }
}
