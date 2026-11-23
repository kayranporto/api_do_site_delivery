export class ListApiClients {
  constructor({ apiClientRepository }) { this.apiClientRepository = apiClientRepository; }
  async execute() { return this.apiClientRepository.list(); }
}
