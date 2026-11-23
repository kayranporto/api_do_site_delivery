import test from 'node:test';
import assert from 'node:assert/strict';
import { Integration } from '../../src/domain/entities/Integration.js';
import { Execution, ExecutionStatus } from '../../src/domain/entities/Execution.js';
import { ProviderExecutionError } from '../../src/application/errors/ProviderExecutionError.js';
import { ProviderNotFoundError } from '../../src/application/errors/ProviderNotFoundError.js';
import {
  ConfigurationNotFoundError,
  EnvironmentSecretResolver,
  HttpRestProviderAdapter,
  InMemoryExecutionRepository,
  InMemoryIntegrationRepository,
  InvalidSecretReferenceError,
  MapConfigurationResolver,
  MapProviderRegistry,
  SecretNotFoundError,
  SystemClock,
  UuidGenerator
} from '../../src/infrastructure/index.js';

function makeIntegration(overrides = {}) {
  return new Integration({
    id: 'integration-infra',
    name: 'Integration infra',
    providerKey: 'test-provider',
    configurationReference: 'config:test:default',
    secretReference: 'env:PROVIDER_TOKEN',
    status: 'active',
    createdAt: new Date('2026-05-01T10:00:00.000Z'),
    ...overrides
  });
}

function makeExecution(overrides = {}) {
  return new Execution({
    id: 'execution-infra',
    integrationId: 'integration-infra',
    operationName: 'records.create',
    input: { name: 'Record' },
    idempotencyKey: 'request-infra-1234',
    createdAt: new Date('2026-05-01T10:01:00.000Z'),
    ...overrides
  });
}

function makeConfig(overrides = {}) {
  return {
    baseUrl: 'https://api.vendor.test',
    allowedHosts: ['api.vendor.test'],
    authentication: { type: 'bearer' },
    operations: {
      'records.create': { method: 'POST', path: '/v1/records' }
    },
    ...overrides
  };
}

function makeCommand(overrides = {}) {
  return {
    executionId: 'execution-1',
    integration: {
      id: 'integration-1',
      providerKey: 'test-provider',
      configurationReference: 'config:vendor:default',
      secretReference: 'env:PROVIDER_TOKEN'
    },
    operationName: 'records.create',
    input: { name: 'Record' },
    idempotencyKey: 'request-12345678',
    timeoutMs: 2_000,
    ...overrides
  };
}

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' }
});

test('InMemoryIntegrationRepository salva, reconstitui e lista integrações', async () => {
  const repository = new InMemoryIntegrationRepository();
  const integration = makeIntegration();
  await repository.save(integration);

  const loaded = await repository.findById(integration.id);
  assert.notEqual(loaded, integration);
  assert.equal(loaded.providerKey.value, 'test-provider');
  loaded.deactivate(new Date('2026-05-01T10:02:00.000Z'));
  assert.equal((await repository.findById(integration.id)).isActive, true);
  assert.equal((await repository.listActive()).length, 1);
  assert.equal((await repository.findByProviderKey('test-provider')).length, 1);
});

test('InMemoryExecutionRepository persiste estado, aplica índice de idempotência e busca retries vencidos', async () => {
  const repository = new InMemoryExecutionRepository();
  const execution = makeExecution();
  execution.startAttempt(new Date('2026-05-01T10:01:01.000Z'));
  execution.fail({
    failedAt: new Date('2026-05-01T10:01:02.000Z'),
    errorCode: 'TEMPORARY_FAILURE',
    retryable: true
  });
  await repository.save(execution);

  const found = await repository.findByIdempotencyKey('integration-infra', 'request-infra-1234');
  assert.equal(found.status, ExecutionStatus.RETRY_SCHEDULED);
  assert.equal((await repository.findDueForRetry(new Date('2026-05-01T10:01:02.999Z'), 10)).length, 0);
  assert.equal((await repository.findDueForRetry(new Date('2026-05-01T10:01:03.000Z'), 10)).length, 1);

  const duplicate = makeExecution({ id: 'execution-duplicate' });
  await assert.rejects(() => repository.save(duplicate), { code: 'IDEMPOTENCY_KEY_CONFLICT' });
});

test('MapConfigurationResolver devolve cópia e sinaliza referência ausente', async () => {
  const resolver = new MapConfigurationResolver({ 'config:one': { nested: { active: true } } });
  const config = await resolver.resolve('config:one');
  config.nested.active = false;
  assert.equal((await resolver.resolve('config:one')).nested.active, true);
  await assert.rejects(() => resolver.resolve('config:missing'), ConfigurationNotFoundError);
});

test('EnvironmentSecretResolver resolve variável sem expor valor em mensagens de erro', async () => {
  const resolver = new EnvironmentSecretResolver({ TOKEN_FOR_TEST: 'top-secret' });
  assert.equal(await resolver.resolve('env:TOKEN_FOR_TEST'), 'top-secret');
  await assert.rejects(() => resolver.resolve('token-in-clear-text'), InvalidSecretReferenceError);
  await assert.rejects(() => resolver.resolve('env:MISSING_TOKEN'), SecretNotFoundError);
});

test('MapProviderRegistry registra e resolve adaptadores por chave', async () => {
  const adapter = { async execute() { return { ok: true }; } };
  const registry = new MapProviderRegistry().register('test-provider', adapter);
  assert.equal(await registry.resolve('test-provider'), adapter);
  await assert.rejects(() => registry.resolve('missing-provider'), ProviderNotFoundError);
  assert.throws(() => registry.register('test-provider', adapter), /já registrado/);
  assert.throws(() => registry.register('invalid-provider', {}), /execute/);
});

test('SystemClock e UuidGenerator fornecem implementações concretas das portas', () => {
  assert.ok(new SystemClock().now() instanceof Date);
  const first = new UuidGenerator().generate();
  const second = new UuidGenerator().generate();
  assert.match(first, /^[0-9a-f-]{36}$/i);
  assert.notEqual(first, second);
});

test('HttpRestProviderAdapter envia JSON, autenticação e não segue redirects', async () => {
  let captured;
  const adapter = new HttpRestProviderAdapter({
    configurationResolver: new MapConfigurationResolver({ 'config:vendor:default': makeConfig() }),
    secretResolver: new EnvironmentSecretResolver({ PROVIDER_TOKEN: 'do-not-log-this' }),
    fetchImpl: async (url, options) => {
      captured = { url: String(url), options };
      return jsonResponse({ id: 'remote-01' });
    }
  });

  const result = await adapter.execute(makeCommand());
  assert.deepEqual(result, { id: 'remote-01' });
  assert.equal(captured.url, 'https://api.vendor.test/v1/records');
  assert.equal(captured.options.method, 'POST');
  assert.equal(captured.options.headers.get('authorization'), 'Bearer do-not-log-this');
  assert.equal(captured.options.redirect, 'manual');
  assert.equal(captured.options.body, JSON.stringify({ name: 'Record' }));
});

test('HttpRestProviderAdapter classifica status HTTP repetíveis e não repetíveis', async () => {
  const makeAdapter = (status) => new HttpRestProviderAdapter({
    configurationResolver: new MapConfigurationResolver({ 'config:vendor:default': makeConfig() }),
    secretResolver: new EnvironmentSecretResolver({ PROVIDER_TOKEN: 'token' }),
    fetchImpl: async () => jsonResponse({ error: true }, status)
  });

  await assert.rejects(() => makeAdapter(503).execute(makeCommand()), (error) => {
    assert.ok(error instanceof ProviderExecutionError);
    assert.equal(error.code, 'PROVIDER_HTTP_503');
    assert.equal(error.retryable, true);
    return true;
  });
  await assert.rejects(() => makeAdapter(400).execute(makeCommand()), (error) => {
    assert.equal(error.code, 'PROVIDER_HTTP_400');
    assert.equal(error.retryable, false);
    return true;
  });
});

test('HttpRestProviderAdapter rejeita host fora da allowlist e redirects', async () => {
  const adapter = new HttpRestProviderAdapter({
    configurationResolver: new MapConfigurationResolver({
      'config:vendor:default': makeConfig({ allowedHosts: ['other.vendor.test'] })
    }),
    fetchImpl: async () => new Response(null, { status: 302, headers: { location: 'https://evil.test' } })
  });
  await assert.rejects(() => adapter.execute(makeCommand()), /allowedHosts/);

  const redirectAdapter = new HttpRestProviderAdapter({
    configurationResolver: new MapConfigurationResolver({ 'config:vendor:default': makeConfig({ authentication: null }) }),
    fetchImpl: async (_url, options) => {
      assert.equal(options.redirect, 'manual');
      return new Response(null, { status: 302, headers: { location: 'https://evil.test' } });
    }
  });
  await assert.rejects(() => redirectAdapter.execute(makeCommand()), (error) => {
    assert.equal(error.code, 'PROVIDER_REDIRECT_BLOCKED');
    return true;
  });
});

test('HttpRestProviderAdapter rejeita caminho externo, host local e cabeçalhos perigosos', async () => {
  const makeAdapter = (config) => new HttpRestProviderAdapter({
    configurationResolver: new MapConfigurationResolver({ 'config:vendor:default': config }),
    fetchImpl: async () => jsonResponse({ ok: true })
  });

  await assert.rejects(() => makeAdapter(makeConfig({ operations: {
    'records.create': { method: 'POST', path: '//evil.test/path' }
  } })).execute(makeCommand()), /caminho da operação/);
  await assert.rejects(() => makeAdapter(makeConfig({ baseUrl: 'https://localhost', allowedHosts: ['localhost'] }))
    .execute(makeCommand()), /Host local/);
  await assert.rejects(() => makeAdapter(makeConfig({ baseUrl: 'https://127.0.0.1', allowedHosts: ['127.0.0.1'] }))
    .execute(makeCommand()), /endereços IP literais/i);
  await assert.rejects(() => makeAdapter(makeConfig({ headers: { Host: 'evil.test' } }))
    .execute(makeCommand()), /header não permitido/);
});

test('HttpRestProviderAdapter aplica limites de payload e resposta', async () => {
  const largeRequestAdapter = new HttpRestProviderAdapter({
    configurationResolver: new MapConfigurationResolver({ 'config:vendor:default': makeConfig({ authentication: null }) }),
    fetchImpl: async () => jsonResponse({ ok: true }),
    maxRequestBytes: 4
  });
  await assert.rejects(() => largeRequestAdapter.execute(makeCommand()), (error) => {
    assert.equal(error.code, 'PROVIDER_REQUEST_TOO_LARGE');
    return true;
  });

  const largeResponseAdapter = new HttpRestProviderAdapter({
    configurationResolver: new MapConfigurationResolver({ 'config:vendor:default': makeConfig({ authentication: null }) }),
    fetchImpl: async () => new Response('long response body', { status: 200 }),
    maxResponseBytes: 4
  });
  await assert.rejects(() => largeResponseAdapter.execute(makeCommand()), (error) => {
    assert.equal(error.code, 'PROVIDER_RESPONSE_TOO_LARGE');
    return true;
  });
});

test('HttpRestProviderAdapter converte falha de rede sem propagar mensagem potencialmente sensível', async () => {
  const adapter = new HttpRestProviderAdapter({
    configurationResolver: new MapConfigurationResolver({ 'config:vendor:default': makeConfig({ authentication: null }) }),
    fetchImpl: async () => { throw new Error('socket detail containing a private token'); }
  });
  await assert.rejects(() => adapter.execute(makeCommand()), (error) => {
    assert.equal(error.code, 'PROVIDER_NETWORK_ERROR');
    assert.equal(error.message.includes('private token'), false);
    assert.equal(error.retryable, true);
    return true;
  });
});


test('HttpRestProviderAdapter encaminha chave idempotente somente quando configurado', async () => {
  let captured;
  const adapter = new HttpRestProviderAdapter({
    configurationResolver: new MapConfigurationResolver({
      'config:vendor:default': makeConfig({
        authentication: null,
        idempotencyHeaderName: 'X-Idempotency-Key'
      })
    }),
    fetchImpl: async (_url, options) => {
      captured = options;
      return jsonResponse({ accepted: true });
    }
  });

  await adapter.execute(makeCommand());
  assert.equal(captured.headers.get('x-idempotency-key'), 'request-12345678');
});

test('HttpRestProviderAdapter impede chave idempotente de sobrescrever Authorization', async () => {
  const adapter = new HttpRestProviderAdapter({
    configurationResolver: new MapConfigurationResolver({
      'config:vendor:default': makeConfig({ idempotencyHeaderName: 'Authorization' })
    }),
    secretResolver: new EnvironmentSecretResolver({ PROVIDER_TOKEN: 'token' }),
    fetchImpl: async () => jsonResponse({ ok: true })
  });
  await assert.rejects(() => adapter.execute(makeCommand()), /idempotencyHeaderName inválido/);
});


test('HttpRestProviderAdapter reconcile consulta somente GET configurado e normaliza estados', async () => {
  let captured;
  const adapter = new HttpRestProviderAdapter({
    configurationResolver: new MapConfigurationResolver({
      'config:vendor:default': makeConfig({
        operations: {
          'records.create': {
            method: 'POST',
            path: '/v1/records',
            reconciliation: {
              method: 'GET',
              path: '/v1/operations/{idempotencyKey}',
              statusField: 'data.state',
              statusMap: {
                succeeded: ['complete', 'done'],
                failed: ['rejected', 'error'],
                pending: ['queued', 'processing'],
                not_found: ['missing']
              }
            }
          }
        }
      })
    }),
    secretResolver: new EnvironmentSecretResolver({ PROVIDER_TOKEN: 'secret-for-test' }),
    fetchImpl: async (url, options) => {
      captured = { url: String(url), options };
      return jsonResponse({ data: { state: 'complete' } });
    }
  });

  const result = await adapter.reconcile(makeCommand({ idempotencyKey: 'key with spaces' }));
  assert.equal(captured.url, 'https://api.vendor.test/v1/operations/key%20with%20spaces');
  assert.equal(captured.options.method, 'GET');
  assert.equal(captured.options.body, undefined);
  assert.equal(captured.options.headers.get('authorization'), 'Bearer secret-for-test');
  assert.equal(result.outcome, 'succeeded');
  assert.equal(result.providerStatus, 'complete');
});

test('HttpRestProviderAdapter retorna not_found quando o endpoint de consulta responde 404', async () => {
  const adapter = new HttpRestProviderAdapter({
    configurationResolver: new MapConfigurationResolver({
      'config:vendor:default': makeConfig({
        authentication: null,
        operations: {
          'records.create': {
            method: 'POST',
            path: '/v1/records',
            reconciliation: {
              method: 'GET',
              path: '/v1/operations/{executionId}',
              statusField: 'status',
              notFoundStatusCodes: [404],
              statusMap: { succeeded: ['complete'] }
            }
          }
        }
      })
    }),
    fetchImpl: async () => jsonResponse({ message: 'missing' }, 404)
  });
  const result = await adapter.reconcile(makeCommand());
  assert.equal(result.outcome, 'not_found');
  assert.equal(result.providerStatus, '404');
});

test('HttpRestProviderAdapter não faz consulta se endpoint de reconciliação não foi configurado', async () => {
  let called = false;
  const adapter = new HttpRestProviderAdapter({
    configurationResolver: new MapConfigurationResolver({ 'config:vendor:default': makeConfig() }),
    fetchImpl: async () => { called = true; return jsonResponse({ ok: true }); }
  });
  assert.deepEqual(await adapter.reconcile(makeCommand()), { outcome: 'unsupported', providerStatus: null });
  assert.equal(called, false);
});

test('HttpRestProviderAdapter rejeita método mutável na consulta de reconciliação', async () => {
  const adapter = new HttpRestProviderAdapter({
    configurationResolver: new MapConfigurationResolver({
      'config:vendor:default': makeConfig({
        operations: {
          'records.create': {
            method: 'POST',
            path: '/v1/records',
            reconciliation: {
              method: 'POST',
              path: '/v1/operations/status',
              statusMap: { succeeded: ['complete'] }
            }
          }
        }
      })
    }),
    fetchImpl: async () => jsonResponse({ ok: true })
  });
  await assert.rejects(() => adapter.reconcile(makeCommand()), /somente GET/);
});
