/** Porta para eventos operacionais sem payloads de negócio ou credenciais. */
export class OperationalEventRepository {
  async append(_event) {
    throw new Error('OperationalEventRepository.append deve ser implementado por um adaptador.');
  }

  async findByExecutionId(_executionId, _limit) {
    throw new Error('OperationalEventRepository.findByExecutionId deve ser implementado por um adaptador.');
  }

  async countSince(_since) {
    throw new Error('OperationalEventRepository.countSince deve ser implementado por um adaptador.');
  }
}
