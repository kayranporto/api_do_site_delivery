import { ProviderExecutionError } from '../errors/ProviderExecutionError.js';

function safeFailure(error) {
  if (error instanceof ProviderExecutionError) {
    return { errorCode: error.code, retryable: error.retryable };
  }
  // Erros desconhecidos nunca são repetidos automaticamente por padrão.
  return { errorCode: 'UNEXPECTED_PROVIDER_ERROR', retryable: false };
}

function createLeaseHeartbeat({ execution, executionRepository, leaseMs }) {
  if (typeof executionRepository.renewLease !== 'function' || !Number.isInteger(leaseMs)) {
    return { signal: undefined, isLost: () => false, stop: () => {} };
  }

  const controller = new AbortController();
  let lost = false;
  let renewing = false;
  const intervalMs = Math.max(250, Math.floor(leaseMs / 3));
  const timer = setInterval(async () => {
    if (renewing || lost) return;
    renewing = true;
    try {
      const renewed = await executionRepository.renewLease(execution, leaseMs);
      if (!renewed) {
        lost = true;
        controller.abort(new Error('EXECUTION_LEASE_LOST'));
        clearInterval(timer);
      }
    } catch {
      lost = true;
      controller.abort(new Error('EXECUTION_LEASE_LOST'));
      clearInterval(timer);
    } finally {
      renewing = false;
    }
  }, intervalMs);
  timer.unref?.();

  return {
    signal: controller.signal,
    isLost: () => lost,
    stop: () => clearInterval(timer)
  };
}

/** Executa uma tentativa; leases são renovados durante o efeito externo e liberados ao persistir o resultado. */
export async function executeProviderAttempt({
  execution,
  integration,
  adapter,
  executionRepository,
  clock,
  leaseMs = 180_000
}) {
  execution.startAttempt(clock.now());
  const heartbeat = createLeaseHeartbeat({ execution, executionRepository, leaseMs });

  try {
    await executionRepository.save(execution, { releaseLease: false });

    const command = {
      executionId: execution.id,
      integration: {
        id: integration.id,
        providerKey: integration.providerKey.value,
        configurationReference: integration.configurationReference.value,
        secretReference: integration.secretReference?.value ?? null
      },
      operationName: execution.operationName.value,
      input: execution.input,
      idempotencyKey: execution.idempotencyKey?.value ?? null,
      timeoutMs: integration.timeoutMs,
      signal: heartbeat.signal
    };

    let result;
    try {
      result = await adapter.execute(command);
    } catch (error) {
      if (heartbeat.isLost()) {
        const leaseError = new Error('O lease da execução foi perdido; o resultado externo é incerto.');
        leaseError.code = 'EXECUTION_LEASE_LOST';
        throw leaseError;
      }
      const failure = safeFailure(error);
      execution.fail({ failedAt: clock.now(), ...failure });
      await executionRepository.save(execution);
      return { execution, result: null, failure, status: execution.status };
    }

    if (heartbeat.isLost()) {
      const leaseError = new Error('O lease da execução foi perdido; o resultado externo é incerto.');
      leaseError.code = 'EXECUTION_LEASE_LOST';
      throw leaseError;
    }

    execution.succeed({ completedAt: clock.now() });
    await executionRepository.save(execution);
    return { execution, result, failure: null, status: execution.status };
  } finally {
    heartbeat.stop();
  }
}
