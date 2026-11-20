/** Scheduler cooperativo: ciclos sequenciais, sem sobreposição, com parada aguardando o ciclo ativo. */
export function createWorker({
  useCases,
  intervalMs = 5_000,
  batchSize = 20,
  staleBatchSize = 50,
  staleAfterMs = 300_000,
  logger = console
}) {
  if (!useCases?.retryDueExecutions || !useCases?.recoverStaleExecutions) {
    throw new TypeError('Os casos de uso de retry e recuperação são obrigatórios.');
  }
  if (!Number.isInteger(intervalMs) || intervalMs < 250 || intervalMs > 300_000) throw new RangeError('intervalMs inválido.');
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) throw new RangeError('batchSize inválido.');
  if (!Number.isInteger(staleBatchSize) || staleBatchSize < 1 || staleBatchSize > 100) throw new RangeError('staleBatchSize inválido.');
  if (!Number.isInteger(staleAfterMs) || staleAfterMs < 10_000 || staleAfterMs > 86_400_000) {
    throw new RangeError('staleAfterMs deve ficar entre 10000 e 86400000.');
  }

  let started = false;
  let stopping = false;
  let timer = null;
  let inFlight = null;

  async function runCycle() {
    if (stopping) return null;
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const recovery = await useCases.recoverStaleExecutions.execute({ limit: staleBatchSize });
      const retries = await useCases.retryDueExecutions.execute({ limit: batchSize });
      const summary = {
        recovered: recovery.recovered ?? 0,
        retried: retries.processed ?? 0,
        checkedStale: recovery.total ?? 0,
        checkedRetries: retries.total ?? 0
      };
      logger.info?.(summary, 'worker cycle completed');
      return { recovery, retries, summary };
    })();
    try {
      return await inFlight;
    } catch (error) {
      logger.error?.({ code: error?.code ?? 'WORKER_CYCLE_FAILED', name: error?.name ?? 'Error' }, 'worker cycle failed');
      return { error: error?.code ?? 'WORKER_CYCLE_FAILED' };
    } finally {
      inFlight = null;
      if (started && !stopping) scheduleNext();
    }
  }

  function scheduleNext() {
    if (timer || stopping || !started) return;
    timer = setTimeout(() => {
      timer = null;
      void runCycle();
    }, intervalMs);
  }

  return {
    async start({ immediate = true } = {}) {
      if (started) return;
      started = true;
      stopping = false;
      if (immediate) await runCycle();
      else scheduleNext();
    },
    async runOnce() {
      if (inFlight) return inFlight;
      return runCycle();
    },
    async stop() {
      if (!started && !inFlight) return;
      stopping = true;
      started = false;
      if (timer) clearTimeout(timer);
      timer = null;
      if (inFlight) await inFlight;
    },
    get isRunning() {
      return started && !stopping;
    }
  };
}
