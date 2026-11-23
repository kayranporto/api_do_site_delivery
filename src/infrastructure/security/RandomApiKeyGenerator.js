import { createHash, randomBytes } from 'node:crypto';

export function hashApiKey(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Chave de alta entropia. O valor bruto só é retornado no momento da criação. */
export class RandomApiKeyGenerator {
  generate() {
    const keyPrefix = randomBytes(8).toString('hex');
    const secret = randomBytes(32).toString('base64url');
    const key = 'gik_' + keyPrefix + '.' + secret;
    return { key, keyPrefix, keyHash: hashApiKey(key) };
  }
}
