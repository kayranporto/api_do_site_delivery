import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../../src/infrastructure/configuration/loadConfig.js';

const TOKEN = 'this-is-a-random-test-token-that-is-long-enough';

test('loadConfig valida token, porta, CORS e configurações de persistência', () => {
  const config = loadConfig({
    API_ACCESS_TOKEN: TOKEN,
    HOST: '127.0.0.1',
    PORT: '3100',
    CORS_ORIGINS: 'https://client.example.test, http://localhost:5173',
    PROVIDER_CONFIG_JSON: '{}'
  });
  assert.equal(config.port, 3100);
  assert.deepEqual(config.corsOrigins, ['https://client.example.test', 'http://localhost:5173']);
  assert.deepEqual(config.providerConfigurations, {});
  assert.equal(config.databaseUrl, null);
  assert.equal(config.databasePoolMax, 10);
  assert.equal(config.nodeEnv, 'development');
  assert.equal(config.rateLimitStore, 'memory');
  assert.equal(config.workerIntervalMs, 5000);
  assert.equal(config.workerBatchSize, 20);
  assert.equal(config.workerStaleAfterMs, 300000);
  assert.equal(config.workerLeaseMs, 180000);

  assert.throws(() => loadConfig({ API_ACCESS_TOKEN: 'short' }), /pelo menos 32 caracteres/);
  assert.throws(() => loadConfig({ API_ACCESS_TOKEN: 'x'.repeat(40), PORT: '70000' }), /PORT/);
  assert.throws(() => loadConfig({ API_ACCESS_TOKEN: 'x'.repeat(40), CORS_ORIGINS: '*' }), /wildcard/);
  assert.throws(() => loadConfig({
    API_ACCESS_TOKEN: 'x'.repeat(40),
    DATABASE_URL: 'https://example.test/database'
  }), /protocolo postgres/);
  assert.throws(() => loadConfig({
    API_ACCESS_TOKEN: 'x'.repeat(40),
    DATABASE_POOL_MAX: '0'
  }), /DATABASE_POOL_MAX/);
  assert.throws(() => loadConfig({
    API_ACCESS_TOKEN: 'x'.repeat(40),
    NODE_ENV: 'production'
  }), /DATABASE_URL é obrigatório/);

  assert.throws(() => loadConfig({ API_ACCESS_TOKEN: 'x'.repeat(40), WORKER_BATCH_SIZE: '101' }), /WORKER_BATCH_SIZE/);
  assert.throws(() => loadConfig({ API_ACCESS_TOKEN: TOKEN, RATE_LIMIT_STORE: 'unknown' }), /memory ou upstash/);
  assert.throws(() => loadConfig({ API_ACCESS_TOKEN: TOKEN, RATE_LIMIT_STORE: 'upstash' }), /UPSTASH_REDIS_REST_URL/);
  assert.throws(() => loadConfig({
    API_ACCESS_TOKEN: TOKEN,
    RATE_LIMIT_STORE: 'upstash',
    UPSTASH_REDIS_REST_URL: 'https://redis.example.test',
    UPSTASH_REDIS_REST_TOKEN: 'short-token'
  }), /UPSTASH_REDIS_REST_TOKEN/);
  assert.throws(() => loadConfig({
    API_ACCESS_TOKEN: TOKEN,
    RATE_LIMIT_STORE: 'memory',
    UPSTASH_REDIS_REST_URL: 'https://redis.example.test'
  }), /somente com RATE_LIMIT_STORE=upstash/);

  const upstash = loadConfig({
    API_ACCESS_TOKEN: TOKEN,
    RATE_LIMIT_STORE: 'upstash',
    UPSTASH_REDIS_REST_URL: 'https://redis.example.test/',
    UPSTASH_REDIS_REST_TOKEN: 'upstash-rest-token-with-sufficient-length'
  });
  assert.equal(upstash.rateLimitStore, 'upstash');
  assert.equal(upstash.upstashRedisRestUrl, 'https://redis.example.test');

  const postgres = loadConfig({
    API_ACCESS_TOKEN: 'x'.repeat(40),
    DATABASE_URL: 'postgresql://service:secret@localhost:5432/integrations',
    DATABASE_POOL_MAX: '15',
    NODE_ENV: 'production',
    RATE_LIMIT_STORE: 'upstash',
    UPSTASH_REDIS_REST_URL: 'https://redis.example.test',
    UPSTASH_REDIS_REST_TOKEN: 'upstash-rest-token-with-sufficient-length'
  });
  assert.equal(postgres.databasePoolMax, 15);
  assert.equal(postgres.nodeEnv, 'production');
  assert.equal(postgres.rateLimitStore, 'upstash');
  assert.throws(() => loadConfig({
    API_ACCESS_TOKEN: TOKEN,
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://service:secret@localhost:5432/integrations'
  }), /RATE_LIMIT_STORE=upstash/);
  assert.throws(() => loadConfig({
    API_ACCESS_TOKEN: TOKEN,
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://service:secret@localhost:5432/integrations',
    RATE_LIMIT_STORE: 'upstash',
    UPSTASH_REDIS_REST_URL: 'http://redis.example.test',
    UPSTASH_REDIS_REST_TOKEN: 'upstash-rest-token-with-sufficient-length'
  }), /HTTPS em produção/);
});
