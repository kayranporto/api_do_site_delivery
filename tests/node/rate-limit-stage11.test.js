import test from 'node:test';
import assert from 'node:assert/strict';
import { createInMemoryRateLimitStore } from '../../src/infrastructure/rate-limits/InMemoryRateLimitStore.js';
import { UpstashRedisRateLimitStore } from '../../src/infrastructure/rate-limits/UpstashRedisRateLimitStore.js';

function fakeRedisFetch({ clock = Date.now } = {}) {
  const values = new Map();
  return async (_url, options) => {
    const command = JSON.parse(options.body);
    if (command[0] === 'EVAL') {
      const rateKey = command[3];
      const usageKey = command[4];
      const windowMs = Number(command[5]);
      const trackUsage = command[6] === '1';
      const retentionSeconds = Number(command[7]);
      const now = clock();
      let bucket = values.get(rateKey);
      if (!bucket || now >= bucket.expiresAt) {
        bucket = { value: 0, expiresAt: now + windowMs };
      }
      bucket.value += 1;
      values.set(rateKey, bucket);
      if (trackUsage) {
        const daily = values.get(usageKey) ?? { value: 0, expiresAt: now + retentionSeconds * 1000 };
        daily.value += 1;
        values.set(usageKey, daily);
      }
      return {
        ok: true,
        async json() { return { result: [bucket.value, bucket.expiresAt - now] }; }
      };
    }
    if (command[0] === 'MGET') {
      return {
        ok: true,
        async json() {
          return { result: command.slice(1).map((key) => {
            const value = values.get(key);
            return value && clock() < value.expiresAt ? String(value.value) : null;
          }) };
        }
      };
    }
    return { ok: false, async json() { return { error: 'unsupported command' }; } };
  };
}

test('store em memória mantém limites e histórico diário por cliente', async () => {
  const store = createInMemoryRateLimitStore();
  const now = Date.UTC(2026, 10, 23, 12);
  const first = await store.consume({
    key: 'client:client-a', windowMs: 10_000, now, usageClientId: 'client-a'
  });
  const second = await store.consume({
    key: 'client:client-a', windowMs: 10_000, now: now + 1, usageClientId: 'client-a'
  });
  assert.equal(first.count, 1);
  assert.equal(second.count, 2);
  const usage = await store.getClientUsage({ clientId: 'client-a', days: 1, now });
  assert.equal(usage.totalRequests, 2);
  assert.equal(usage.daily[0].requests, 2);
});

test('duas instâncias Redis compartilham contadores e a gravação de consumo é atômica', async () => {
  const now = Date.UTC(2026, 10, 23, 12);
  const fetchImpl = fakeRedisFetch({ clock: () => now });
  const options = {
    url: 'https://redis.example.test',
    token: 'upstash-rest-token-with-sufficient-length',
    fetchImpl
  };
  const firstInstance = new UpstashRedisRateLimitStore(options);
  const secondInstance = new UpstashRedisRateLimitStore(options);

  const first = await firstInstance.consume({
    key: 'client:client-shared', windowMs: 60_000, now, usageClientId: 'client-shared'
  });
  const second = await secondInstance.consume({
    key: 'client:client-shared', windowMs: 60_000, now, usageClientId: 'client-shared'
  });
  assert.equal(first.count, 1);
  assert.equal(second.count, 2);

  const usage = await secondInstance.getClientUsage({
    clientId: 'client-shared', days: 1, now
  });
  assert.equal(usage.totalRequests, 2);
});

test('store Redis interrompe a requisição quando o serviço compartilhado falha', async () => {
  const store = new UpstashRedisRateLimitStore({
    url: 'https://redis.example.test',
    token: 'upstash-rest-token-with-sufficient-length',
    fetchImpl: async () => ({ ok: false, async json() { return { error: 'unavailable' }; } })
  });
  await assert.rejects(() => store.consume({
    key: 'ip:192.0.2.1',
    windowMs: 60_000
  }), /comando no Redis compartilhado falhou/);
});
