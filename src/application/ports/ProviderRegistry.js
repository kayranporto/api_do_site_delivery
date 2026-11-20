/** Porta de saída: resolve um adaptador de provedor por sua chave lógica. */
export class ProviderRegistry {
  async resolve(_providerKey) {
    throw new Error('ProviderRegistry.resolve deve ser implementado por um adaptador.');
  }
}
