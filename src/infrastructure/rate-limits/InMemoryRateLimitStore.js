const DAY_MS = 24 * 60 * 60 * 1000;
const USAGE_RETENTION_DAYS = 35;

function dateKey(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

/** Armazenamento local para desenvolvimento e testes. Não coordena réplicas. */
export class InMemoryRateLimitStore {
  constructor({ maxClients = 10_000 } = {}) {
    if (!Number.isInteger(maxClients) || maxClients < 100 || maxClients > 100_000) {
      throw new RangeError('maxClients deve estar entre 100 e 100000.');
    }
    this.maxClients = maxClients;
    this.buckets = new Map();
    this.usage = new Map();
  }

  async ping() {
    return true;
  }

  async consume({ key, windowMs, now = Date.now(), usageClientId = null }) {
    if (typeof key !== 'string' || !key) throw new TypeError('Chave de rate limit inválida.');
    if (!Number.isInteger(windowMs) || windowMs < 1_000 || windowMs > 3_600_000) {
      throw new RangeError('windowMs deve estar entre 1000 e 3600000.');
    }
    if (!Number.isFinite(now)) throw new TypeError('now deve ser um timestamp válido.');
    if (usageClientId !== null && (typeof usageClientId !== 'string' || !usageClientId)) {
      throw new TypeError('usageClientId deve ser uma string não vazia.');
    }

    let bucket = this.buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      if (this.buckets.size >= this.maxClients) {
        for (const [client, entry] of this.buckets) {
          if (now >= entry.resetAt) this.buckets.delete(client);
        }
      }
      if (this.buckets.size >= this.maxClients && !this.buckets.has(key)) {
        return { capacityExceeded: true };
      }
      bucket = { count: 0, resetAt: now + windowMs };
      this.buckets.set(key, bucket);
    }

    bucket.count += 1;
    if (usageClientId) {
      this.pruneUsage(now);
      const dailyKey = usageClientId + ':' + dateKey(now);
      this.usage.set(dailyKey, (this.usage.get(dailyKey) ?? 0) + 1);
    }
    return { count: bucket.count, resetAt: bucket.resetAt };
  }

  async getClientUsage({ clientId, days = 30, now = Date.now() }) {
    if (typeof clientId !== 'string' || !clientId) throw new TypeError('clientId é obrigatório.');
    if (!Number.isInteger(days) || days < 1 || days > 30) throw new RangeError('days deve estar entre 1 e 30.');

    const daily = [];
    for (let offset = days - 1; offset >= 0; offset -= 1) {
      const date = dateKey(now - offset * DAY_MS);
      daily.push({
        date,
        requests: this.usage.get(clientId + ':' + date) ?? 0
      });
    }
    return {
      daily,
      totalRequests: daily.reduce((sum, item) => sum + item.requests, 0)
    };
  }

  pruneUsage(now) {
    const minimumDate = dateKey(now - USAGE_RETENTION_DAYS * DAY_MS);
    for (const key of this.usage.keys()) {
      const separator = key.lastIndexOf(':');
      if (separator >= 0 && key.slice(separator + 1) < minimumDate) this.usage.delete(key);
    }
  }
}

export function createInMemoryRateLimitStore(options) {
  return new InMemoryRateLimitStore(options);
}
