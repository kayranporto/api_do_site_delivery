import { ExecutionStatus } from '../../domain/entities/Execution.js';
import { NotFoundError } from '../errors/NotFoundError.js';
import { ProviderNotFoundError } from '../errors/ProviderNotFoundError.js';
import { recordOperationalEvent } from '../services/recordOperationalEvent.js';

const ALLOWED_OUTCOMES = new Set(['succeeded', 'failed', 'pending', 'not_found', 'unknown']);

function safeProviderStatus(value) {
  if (typeof value !== 'string') return null;
  return value.trim().slice(0, 80);
}

export class ReconcileInterruptedExecution {
  constructor({ executionRepository, integrationRepository, providerRegistry, eventRepository, clock, logger = console }) {
    this.executionRepository = executionRepository;
    this.integrationRepository = integrationRepository;
    this.providerRegistry = providerRegistry;
    this.eventRepository = eventRepository;
    this.clock = clock;
    this.logger = logger;
  }

  async execute({ executionId }) {
    const execution = await this.executionRepository.findById(executionId);
    if (!execution) throw new NotFoundError('Execução', executionId);
    if (execution.status !== ExecutionStatus.INTERRUPTED) {
      const error = new Error('Somente execuções interrompidas podem ser reconciliadas.');
      error.code = 'EXECUTION_NOT_INTERRUPTED';
      throw error;
    }

    const integration = await this.integrationRepository.findById(execution.integrationId);
    if (!integration) throw new NotFoundError('Integração', execution.integrationId);

    await recordOperationalEvent({
      eventRepository: this.eventRepository,
      logger: this.logger,
      executionId: execution.id,
      integrationId: integration.id,
      eventType: 'execution.reconciliation_requested',
      createdAt: this.clock.now()
    });

    let adapter;
    try {
      adapter = await this.providerRegistry.resolve(integration.providerKey.value);
    } catch (error) {
      if (!(error instanceof ProviderNotFoundError)) throw error;
      await this.#recordUnsupported(execution, integration, 'provider_not_registered');
      return { executionId: execution.id, executionStatus: execution.status, outcome: 'unsupported', reason: 'provider_not_registered' };
    }

    if (typeof adapter?.reconcile !== 'function') {
      await this.#recordUnsupported(execution, integration, 'provider_reconciliation_not_supported');
      return { executionId: execution.id, executionStatus: execution.status, outcome: 'unsupported', reason: 'provider_reconciliation_not_supported' };
    }

    try {
      const result = await adapter.reconcile({
        executionId: execution.id,
        integration: {
          id: integration.id,
          providerKey: integration.providerKey.value,
          configurationReference: integration.configurationReference.value,
          secretReference: integration.secretReference?.value ?? null
        },
        operationName: execution.operationName.value,
        idempotencyKey: execution.idempotencyKey?.value ?? null,
        timeoutMs: integration.timeoutMs
      });

      if (result?.outcome === 'unsupported') {
        await this.#recordUnsupported(execution, integration, 'provider_reconciliation_not_configured');
        return {
          executionId: execution.id,
          executionStatus: execution.status,
          outcome: 'unsupported',
          reason: 'provider_reconciliation_not_configured'
        };
      }

      const outcome = ALLOWED_OUTCOMES.has(result?.outcome) ? result.outcome : 'unknown';
      const providerStatus = safeProviderStatus(result?.providerStatus);
      await recordOperationalEvent({
        eventRepository: this.eventRepository,
        logger: this.logger,
        executionId: execution.id,
        integrationId: integration.id,
        eventType: 'execution.reconciliation_completed',
        severity: ['succeeded', 'failed', 'not_found'].includes(outcome) ? 'info' : 'warning',
        details: { outcome, providerStatus },
        createdAt: this.clock.now()
      });
      return {
        executionId: execution.id,
        executionStatus: execution.status,
        outcome,
        providerStatus,
        checkedAt: this.clock.now()
      };
    } catch (error) {
      const errorCode = /^[A-Z][A-Z0-9_]{1,63}$/.test(error?.code ?? '')
        ? error.code
        : 'RECONCILIATION_LOOKUP_FAILED';
      await recordOperationalEvent({
        eventRepository: this.eventRepository,
        logger: this.logger,
        executionId: execution.id,
        integrationId: integration.id,
        eventType: 'execution.reconciliation_failed',
        severity: 'error',
        details: { errorCode },
        createdAt: this.clock.now()
      });
      return {
        executionId: execution.id,
        executionStatus: execution.status,
        outcome: 'lookup_failed',
        errorCode,
        checkedAt: this.clock.now()
      };
    }
  }

  async #recordUnsupported(execution, integration, reason) {
    await recordOperationalEvent({
      eventRepository: this.eventRepository,
      logger: this.logger,
      executionId: execution.id,
      integrationId: integration.id,
      eventType: 'execution.reconciliation_unsupported',
      severity: 'warning',
      details: { reason },
      createdAt: this.clock.now()
    });
  }
}
