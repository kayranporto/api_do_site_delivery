const ALLOWED_DETAILS = new Set([
  'attempt', 'errorCode', 'retryable', 'status', 'outcome',
  'providerStatus', 'reason', 'durationMs'
]);

function safeDetails(details = {}) {
  const safe = {};
  for (const [key, value] of Object.entries(details)) {
    if (!ALLOWED_DETAILS.has(key)) continue;
    if (typeof value === 'string') safe[key] = value.slice(0, 120);
    else if (typeof value === 'number' && Number.isFinite(value)) safe[key] = value;
    else if (typeof value === 'boolean') safe[key] = value;
  }
  return safe;
}

/** Observabilidade não deve transformar uma operação externa já concluída em falha de negócio. */
export async function recordOperationalEvent({
  eventRepository,
  logger = console,
  executionId,
  integrationId,
  eventType,
  severity = 'info',
  details = {},
  createdAt = new Date()
}) {
  if (!eventRepository || typeof eventRepository.append !== 'function') return null;
  try {
    return await eventRepository.append({
      executionId,
      integrationId,
      eventType,
      severity,
      details: safeDetails(details),
      createdAt
    });
  } catch (error) {
    logger.error?.({
      code: error?.code ?? 'EVENT_WRITE_FAILED',
      eventType,
      executionId
    }, 'operational event could not be persisted');
    return null;
  }
}
