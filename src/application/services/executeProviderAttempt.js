import { ProviderExecutionError } from '../errors/ProviderExecutionError.js';

function safeFailure(error) {
  if (error instanceof ProviderExecutionError) {
    return { errorCode: error.code, retryable: error.retryable };
  }
  // Erros desconhecidos nunca são repetidos automaticamente por padrão.
  return { errorCode: 'UNEXPECTED_PROVIDER_ERROR', retryable: false };
}

/** Executa exatamente uma tentativa e persiste antes e depois do efeito externo. */
export async function executeProviderAttempt({
  execution,
  integration,
  adapter,
  executionRepository,
  clock
}) {
  execution.startAttempt(clock.now());
  await executionRepository.save(execution);

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
    timeoutMs: integration.timeoutMs
  };

  let result;
  try {
    result = await adapter.execute(command);
  } catch (error) {
    const failure = safeFailure(error);
    execution.fail({ failedAt: clock.now(), ...failure });
    await executionRepository.save(execution);
    return { execution, result: null, failure, status: execution.status };
  }

  execution.succeed({ completedAt: clock.now() });
  await executionRepository.save(execution);
  return { execution, result, failure: null, status: execution.status };
}
