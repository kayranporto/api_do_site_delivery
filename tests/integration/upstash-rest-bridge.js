import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const MAX_BODY_BYTES = 64 * 1024;

function respond(res, statusCode, payload) {
  res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(payload));
}

/**
 * Local-only adapter for integration tests.
 * It translates the Upstash REST payload used by the API into redis-cli calls.
 * It is not included in application runtime code and must never be deployed.
 */
export async function startRedisRestBridge({
  host = '127.0.0.1',
  port = 0,
  redisHost = '127.0.0.1',
  redisPort = 6379,
  token
} = {}) {
  if (host !== '127.0.0.1') throw new Error('A ponte REST de teste deve escutar apenas em 127.0.0.1.');
  if (typeof token !== 'string' || token.length < 16) throw new Error('Token temporário da ponte REST inválido.');
  if (!new Set(['127.0.0.1', 'localhost', '::1']).has(redisHost)) {
    throw new Error('A ponte REST de teste só pode acessar Redis em loopback.');
  }
  if (!Number.isInteger(redisPort) || redisPort < 1 || redisPort > 65535) throw new Error('REDIS_PORT inválido.');

  const server = createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/') return respond(res, 404, { error: 'not_found' });
    if (req.headers.authorization !== 'Bearer ' + token) return respond(res, 401, { error: 'unauthorized' });

    const chunks = [];
    let bytes = 0;
    try {
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > MAX_BODY_BYTES) return respond(res, 413, { error: 'payload_too_large' });
        chunks.push(chunk);
      }
      const command = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!Array.isArray(command) || command.length < 1
        || !command.every((part) => typeof part === 'string')) {
        return respond(res, 400, { error: 'invalid_command' });
      }
      const name = command[0].toUpperCase();
      const permitted = (name === 'PING' && command.length === 1)
        || (name === 'MGET' && command.length >= 2)
        || (name === 'EVAL' && command.length >= 5 && command[1].includes('redis.call'));
      if (!permitted) return respond(res, 400, { error: 'command_not_permitted' });

      const { stdout } = await execFileAsync('redis-cli', [
        '--json', '-h', redisHost, '-p', String(redisPort), ...command
      ], { timeout: 5_000, maxBuffer: 128 * 1024 });
      let result;
      try {
        result = JSON.parse(stdout.trim());
      } catch {
        return respond(res, 502, { error: 'invalid_redis_response' });
      }
      return respond(res, 200, { result });
    } catch {
      return respond(res, 502, { error: 'redis_unavailable' });
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  return {
    url: 'http://' + host + ':' + address.port,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  };
}
