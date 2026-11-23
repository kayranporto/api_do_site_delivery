import {
  ActivateIntegration,
  CancelExecution,
  CreateIntegration,
  DeactivateIntegration,
  ExecuteOperation,
  GetExecution,
  GetIntegration,
  ListActiveIntegrations,
  RetryDueExecutions,
  RecoverStaleExecutions,
  ReconcileInterruptedExecution,
  GetOperationalMetrics,
  GetExecutionEvents,
  CreateApiClient,
  ListApiClients,
  RevokeApiClient,
  ListApiClientAudit,
  RotateApiClient,
  UpdateApiClientLimits
} from '../application/index.js';
import {
  EnvironmentSecretResolver,
  HttpRestProviderAdapter,
  InMemoryExecutionRepository,
  InMemoryIntegrationRepository,
  InMemoryOperationalEventRepository,
  InMemoryApiClientRepository,
  MapConfigurationResolver,
  MapProviderRegistry,
  SystemClock,
  UuidGenerator,
  RandomApiKeyGenerator
} from '../infrastructure/index.js';

/** Composition root. Por padrão usa memória: adequado apenas para desenvolvimento local. */
export function createContainer({
  providerConfigurations = {},
  environment = process.env,
  fetchImpl = globalThis.fetch,
  repositories = {},
  executionLeaseMs = 180_000,
  staleAfterMs = 300_000
} = {}) {
  const integrationRepository = repositories.integration ?? new InMemoryIntegrationRepository();
  const executionRepository = repositories.execution ?? new InMemoryExecutionRepository();
  const eventRepository = repositories.events ?? new InMemoryOperationalEventRepository();
  const apiClientRepository = repositories.apiClients ?? new InMemoryApiClientRepository();
  const clock = new SystemClock();
  const idGenerator = new UuidGenerator();
  const apiKeyGenerator = new RandomApiKeyGenerator();
  const configurationResolver = new MapConfigurationResolver(providerConfigurations);
  const secretResolver = new EnvironmentSecretResolver(environment);
  const providerRegistry = new MapProviderRegistry();

  const registeredProviders = new Set();
  for (const configuration of Object.values(providerConfigurations)) {
    if (!configuration || typeof configuration.providerKey !== 'string') {
      throw new Error('Cada configuração de provedor precisa declarar providerKey.');
    }
    if (registeredProviders.has(configuration.providerKey)) continue;
    providerRegistry.register(configuration.providerKey, new HttpRestProviderAdapter({
      configurationResolver,
      secretResolver,
      fetchImpl
    }));
    registeredProviders.add(configuration.providerKey);
  }

  const dependencies = {
    integrationRepository,
    executionRepository,
    eventRepository,
    providerRegistry,
    clock,
    idGenerator,
    leaseMs: executionLeaseMs
  };

  const useCases = {
    createIntegration: new CreateIntegration(dependencies),
    activateIntegration: new ActivateIntegration(dependencies),
    deactivateIntegration: new DeactivateIntegration(dependencies),
    getIntegration: new GetIntegration(dependencies),
    listActiveIntegrations: new ListActiveIntegrations(dependencies),
    executeOperation: new ExecuteOperation(dependencies),
    retryDueExecutions: new RetryDueExecutions(dependencies),
    cancelExecution: new CancelExecution(dependencies),
    getExecution: new GetExecution({ executionRepository }),
    getExecutionEvents: new GetExecutionEvents({ executionRepository, eventRepository }),
    getOperationalMetrics: new GetOperationalMetrics({ executionRepository, eventRepository, clock }),
    reconcileInterruptedExecution: new ReconcileInterruptedExecution({
      executionRepository,
      integrationRepository,
      providerRegistry,
      eventRepository,
      clock
    }),
    recoverStaleExecutions: new RecoverStaleExecutions({
      executionRepository,
      eventRepository,
      clock,
      staleAfterMs,
      leaseMs: executionLeaseMs
    }),
    createApiClient: new CreateApiClient({ apiClientRepository, idGenerator, clock, apiKeyGenerator }),
    listApiClients: new ListApiClients({ apiClientRepository }),
    revokeApiClient: new RevokeApiClient({ apiClientRepository, clock }),
    listApiClientAudit: new ListApiClientAudit({ apiClientRepository }),
    rotateApiClient: new RotateApiClient({ apiClientRepository, clock, apiKeyGenerator }),
    updateApiClientLimits: new UpdateApiClientLimits({ apiClientRepository, clock })
  };

  return {
    repositories: { integrationRepository, executionRepository, eventRepository, apiClientRepository },
    adapters: { providerRegistry, configurationResolver, secretResolver, clock, idGenerator, apiKeyGenerator },
    useCases
  };
}
