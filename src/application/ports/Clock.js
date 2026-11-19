/** Porta de saída para tornar o tempo determinístico em testes e execução. */
export class Clock {
  now() {
    throw new Error('Clock.now deve ser implementado por um adaptador.');
  }
}
