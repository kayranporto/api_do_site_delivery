import { describe, expect, test } from '@jest/globals';
import request from 'supertest';
import { createContainer } from '../../../src/bootstrap/createContainer.js';
import { createHttpApp } from '../../../src/infrastructure/http/createHttpApp.js';
import { UpstashRedisRateLimitStore } from '../../../src/infrastructure/rate-limits/UpstashRedisRateLimitStore.js';

const MASTER_TOKEN = 'master-stage11-token-with-at-least-thirty-two-characters';

function sharedRedisFetch() {
  const values = new Map();
  return async (_url, options) => {
    const command = JSON.parse(options.body);
    const now = Date.now();
    if (command[0] === 'EVAL') {
      const rateKey = command[3];
      const usageKey = command[4];
      const windowMs = Number(command[5]);
      const trackUsage = command[6] === '1';
      const retentionSeconds = Number(command[7]);
      let bucket = values.get(rateKey);
      if (!bucket || now >= bucket.expiresAt) bucket = { count: 0, expiresAt: now + windowMs };
      bucket.count += 1;
      values.set(rateKey, bucket);
      if (trackUsage) {
        const daily = values.get(usageKey) ?? { count: 0, expiresAt: now + retentionSeconds * 1000 };
        daily.count += 1;
        values.set(usageKey, daily);
      }
      return { ok: true, async json() { return { result: [bucket.count, bucket.expiresAt - now] }; } };
    }
    if (command[0] === 'MGET') {
      return {
        ok: true,
        async json() {
          return { result: command.slice(1).map((key) => {
            const entry = values.get(key);
            return entry && now < entry.expiresAt ? String(entry.count) : null;
          }) };
        }
      };
    }
    return { ok: false, async json() { return { error: 'unsupported' }; } };
  };
}

describe('distributed rate limiting', () => {
  test('two HTTP instances share an API-client quota and expose daily consumption to master only', async () => {
    const container = createContainer({ environment: {} });
    const sharedFetch = sharedRedisFetch();
    const makeApp = () => createHttpApp({
      useCases: container.useCases,
      apiAccessToken: MASTER_TOKEN,
      apiClientRepository: container.repositories.apiClientRepository,
      executionRepository: container.repositories.executionRepository,
      rateLimitStore: new UpstashRedisRateLimitStore({
        url: 'https://redis.example.test',
        token: 'upstash-rest-token-with-sufficient-length',
        fetchImpl: sharedFetch
      }),
      rateLimitMax: 100
    });
    const firstApp = makeApp();
    const secondApp = makeApp();
    const master = (req) => req.set('Authorization', 'Bearer ' + MASTER_TOKEN);

    const created = await master(request(firstApp).post('/api/v1/clients')).send({
      name: 'Shared quota client',
      scopes: ['integrations:read'],
      integrationIds: null,
      rateLimitMax: 1,
      rateLimitWindowMs: 60_000
    }).expect(201);

    const accessCheck = await master(request(firstApp).post('/api/v1/clients')).send({
      name: 'Usage access check',
      scopes: ['integrations:read'],
      integrationIds: null,
      rateLimitMax: 10,
      rateLimitWindowMs: 60_000
    }).expect(201);
    await request(firstApp)
      .get('/api/v1/clients/' + created.body.data.id + '/usage?days=1')
      .set('Authorization', 'Bearer ' + accessCheck.body.credential)
      .expect(403);

    const callWithClient = (app) => request(app).get('/api/v1/integrations')
      .set('Authorization', 'Bearer ' + created.body.credential);

    await callWithClient(firstApp).expect(200);
    const blocked = await callWithClient(secondApp).expect(429);
    expect(blocked.body.error.code).toBe('RATE_LIMIT_EXCEEDED');

    const usage = await master(request(firstApp)
      .get('/api/v1/clients/' + created.body.data.id + '/usage?days=1')).expect(200);
    expect(usage.body.data.totalRequests).toBe(2);
    expect(usage.body.data.daily[0].requests).toBe(2);
  });
});
