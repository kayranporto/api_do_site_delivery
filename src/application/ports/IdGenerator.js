/** Porta de saída para geração de identificadores sem acoplar o domínio a um runtime. */
export class IdGenerator {
  generate() {
    throw new Error('IdGenerator.generate deve ser implementado por um adaptador.');
  }
}
