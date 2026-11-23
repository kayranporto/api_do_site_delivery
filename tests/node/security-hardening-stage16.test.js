import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../../src/infrastructure/configuration/loadConfig.js';

const MASTER = 'master-secret-token-with-at-least-thirty-two-characters';
const METRICS = 'metrics-secret-token-with-at-least-thirty-two-characters';
const UPSTASH = 'upstash-secret-token-with-sufficient-length';
const WEBHOOK = 'webhook-secret-token-with-sufficient-length';

const PRODUCTION_ENV = {
  API_ACCESS_TOKEN: MASTER,
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://service:database-secret@db.example.test:5432/integrations',
  RATE_LIMIT_STORE: 'upstash',
  UPSTASH_REDIS_REST_URL: 'https://redis.example.test',
  UPSTASH_REDIS_REST_TOKEN: UPSTASH,
  METRICS_ACCESS_TOKEN: METRICS
};

test('aceita somente NODE_ENV conhecido e impede que erros de digitação desativem as proteções de produção', () => {
  assert.equal(loadConfig({ API_ACCESS_TOKEN: MASTER, NODE_ENV: 'development' }).nodeEnv, 'development');
  assert.equal(loadConfig({ API_ACCESS_TOKEN: MASTER, NODE_ENV: 'test' }).nodeEnv, 'test');
  assert.equal(loadConfig(PRODUCTION_ENV).nodeEnv, 'production');

  for (const nodeEnv of ['prod', 'prodution', 'staging', '', 'Production']) {
    assert.throws(
      () => loadConfig({ API_ACCESS_TOKEN: MASTER, NODE_ENV: nodeEnv }),
      /NODE_ENV deve ser development, test ou production/
    );
  }
});

test('rejeita segredos de exemplo, espaços e tokens com comprimento insuficiente', () => {
  assert.throws(
    () => loadConfig({ API_ACCESS_TOKEN: 'replace-with-a-random-secret-at-least-32-characters' }),
    /API_ACCESS_TOKEN/
  );
  assert.throws(
    () => loadConfig({ API_ACCESS_TOKEN: 'secret value with whitespace and more than 32 chars' }),
    /API_ACCESS_TOKEN/
  );
  assert.throws(
    () => loadConfig({ API_ACCESS_TOKEN: 'short' }),
    /API_ACCESS_TOKEN/
  );
  assert.equal(loadConfig({ API_ACCESS_TOKEN: MASTER }).apiAccessToken, MASTER);
});

test('produção exige origens CORS HTTPS', () => {
  assert.throws(
    () => loadConfig({ ...PRODUCTION_ENV, CORS_ORIGINS: 'http://console.example.test' }),
    /CORS_ORIGINS deve usar HTTPS em produção/
  );
  const config = loadConfig({
    ...PRODUCTION_ENV,
    CORS_ORIGINS: 'https://console.example.test'
  });
  assert.deepEqual(config.corsOrigins, ['https://console.example.test']);
});

test('separa credenciais master, Redis, métricas e webhook', () => {
  assert.throws(
    () => loadConfig({ ...PRODUCTION_ENV, METRICS_ACCESS_TOKEN: MASTER }),
    /METRICS_ACCESS_TOKEN deve ser diferente/
  );
  assert.throws(
    () => loadConfig({ ...PRODUCTION_ENV, UPSTASH_REDIS_REST_TOKEN: MASTER }),
    /UPSTASH_REDIS_REST_TOKEN deve ser diferente/
  );
  assert.throws(
    () => loadConfig({
      ...PRODUCTION_ENV,
      ALERT_WEBHOOK_URL: 'https://alerts.example.test/hook',
      ALERT_WEBHOOK_TOKEN: METRICS
    }),
    /ALERT_WEBHOOK_TOKEN deve ser diferente/
  );
  assert.equal(loadConfig({
    ...PRODUCTION_ENV,
    ALERT_WEBHOOK_URL: 'https://alerts.example.test/hook',
    ALERT_WEBHOOK_TOKEN: WEBHOOK
  }).alertWebhookToken, WEBHOOK);
});

test('webhook HTTPS não aceita credenciais, query string ou fragmento na URL', () => {
  for (const ALERT_WEBHOOK_URL of [
    'http://alerts.example.test/hook',
    'https://user:password@alerts.example.test/hook',
    'https://alerts.example.test/hook?token=secret',
    'https://alerts.example.test/hook#fragment'
  ]) {
    assert.throws(
      () => loadConfig({ API_ACCESS_TOKEN: MASTER, ALERT_WEBHOOK_URL }),
      /ALERT_WEBHOOK_URL/
    );
  }
});
