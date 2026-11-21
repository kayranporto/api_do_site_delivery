import test from 'node:test';
import assert from 'node:assert/strict';
import { createRateLimiter } from '../../src/infrastructure/http/middleware/rateLimit.js';

function response() {
  return {
    headers: {},
    statusCode: 200,
    body: null,
    setHeader(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test('rate limiter permite até o limite e responde 429 ao exceder a janela', () => {
  let now = 10_000;
  const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 2, clock: () => now });
  const req = { ip: '192.0.2.1', requestId: 'request-1' };
  let nextCalls = 0;
  const next = () => { nextCalls += 1; };

  const first = response();
  limiter(req, first, next);
  const second = response();
  limiter(req, second, next);
  const third = response();
  limiter(req, third, next);

  assert.equal(nextCalls, 2);
  assert.equal(first.headers['x-ratelimit-remaining'], '1');
  assert.equal(second.headers['x-ratelimit-remaining'], '0');
  assert.equal(third.statusCode, 429);
  assert.equal(third.body.error.code, 'RATE_LIMIT_EXCEEDED');
  assert.equal(third.headers['retry-after'], '60');

  now += 60_001;
  const renewed = response();
  limiter(req, renewed, next);
  assert.equal(renewed.statusCode, 200);
  assert.equal(nextCalls, 3);
});

test('rate limiter mantém buckets separados por IP e valida configuração', () => {
  const limiter = createRateLimiter({ maxRequests: 1 });
  let nextCalls = 0;
  const next = () => { nextCalls += 1; };
  limiter({ ip: '192.0.2.1' }, response(), next);
  limiter({ ip: '192.0.2.2' }, response(), next);
  assert.equal(nextCalls, 2);
  assert.throws(() => createRateLimiter({ windowMs: 10 }), RangeError);
});
