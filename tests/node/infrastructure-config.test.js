import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../../src/infrastructure/configuration/loadConfig.js';

test('loadConfig valida token, porta e origens CORS exatas', () => {
  const config = loadConfig({
    API_ACCESS_TOKEN: 'this-is-a-random-test-token-that-is-long-enough',
    HOST: '127.0.0.1',
    PORT: '3100',
    CORS_ORIGINS: 'https://client.example.test, http://localhost:5173',
    PROVIDER_CONFIG_JSON: '{}'
  });
  assert.equal(config.port, 3100);
  assert.deepEqual(config.corsOrigins, ['https://client.example.test', 'http://localhost:5173']);
  assert.deepEqual(config.providerConfigurations, {});
  assert.throws(() => loadConfig({ API_ACCESS_TOKEN: 'short' }), /pelo menos 32 caracteres/);
  assert.throws(() => loadConfig({ API_ACCESS_TOKEN: 'x'.repeat(40), PORT: '70000' }), /PORT/);
  assert.throws(() => loadConfig({ API_ACCESS_TOKEN: 'x'.repeat(40), CORS_ORIGINS: '*' }), /wildcard/);
});
