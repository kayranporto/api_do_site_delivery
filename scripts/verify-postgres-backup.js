import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const SOURCE_DATABASE = 'stage17_homologation';
const RESTORE_DATABASE = 'stage18_restore_verification';
const TABLES = [
  ['schema_migrations', 'version'],
  ['integrations', 'id'],
  ['executions', 'id'],
  ['execution_events', 'id'],
  ['api_clients', 'id'],
  ['api_client_audit', 'id']
];

function isolatedConnection(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('DATABASE_URL inválida.'); }

  const allowedHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !allowedHosts.has(url.hostname)
    || database !== SOURCE_DATABASE
    || process.env.STAGING_ALLOW_DB_RESET !== 'true') {
    throw new Error(
      'Proteção: a verificação só aceita PostgreSQL local, stage17_homologation e STAGING_ALLOW_DB_RESET=true.'
    );
  }
  return url;
}

async function fingerprint(pool) {
  const result = {};
  for (const [table, orderBy] of TABLES) {
    const query = [
      'SELECT COUNT(*)::integer AS row_count,',
      "MD5(COALESCE(STRING_AGG(TO_JSONB(t)::text, E'\\n' ORDER BY " + orderBy + "), '')) AS content_digest",
      'FROM ' + table + ' t'
    ].join(' ');
    const { rows } = await pool.query(query);
    result[table] = rows[0];
  }
  return result;
}

async function verifyBackupRestore() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL é obrigatório.');
  const sourceUrl = isolatedConnection(process.env.DATABASE_URL);
  const restoreUrl = new URL(sourceUrl);
  restoreUrl.pathname = '/' + RESTORE_DATABASE;
  const adminUrl = new URL(sourceUrl);
  adminUrl.pathname = '/postgres';

  const { Pool } = await import('pg');
  const adminPool = new Pool({ connectionString: adminUrl.toString(), max: 1, connectionTimeoutMillis: 5_000 });
  let sourcePool;
  let restorePool;
  let targetCreated = false;
  let temporaryDirectory;

  try {
    const existing = await adminPool.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [RESTORE_DATABASE]
    );
    if (existing.rows.length) {
      throw new Error('O banco temporário de restauração já existe; recusando sobrescrevê-lo.');
    }

    await adminPool.query('CREATE DATABASE ' + RESTORE_DATABASE);
    targetCreated = true;
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'stage18-postgres-backup-'));
    const archivePath = join(temporaryDirectory, 'homologation.dump');

    await execFileAsync('pg_dump', [
      '--format=custom',
      '--no-owner',
      '--no-acl',
      '--file', archivePath,
      sourceUrl.toString()
    ], { timeout: 120_000, maxBuffer: 1024 * 1024 });

    await execFileAsync('pg_restore', [
      '--exit-on-error',
      '--no-owner',
      '--no-acl',
      '--dbname', restoreUrl.toString(),
      archivePath
    ], { timeout: 120_000, maxBuffer: 1024 * 1024 });

    sourcePool = new Pool({ connectionString: sourceUrl.toString(), max: 1, connectionTimeoutMillis: 5_000 });
    restorePool = new Pool({ connectionString: restoreUrl.toString(), max: 1, connectionTimeoutMillis: 5_000 });
    await sourcePool.query('SELECT 1');
    await restorePool.query('SELECT 1');

    const [sourceFingerprint, restoredFingerprint] = await Promise.all([
      fingerprint(sourcePool),
      fingerprint(restorePool)
    ]);
    if (JSON.stringify(sourceFingerprint) !== JSON.stringify(restoredFingerprint)) {
      throw new Error('A restauração foi concluída, mas o conteúdo das tabelas não corresponde ao backup.');
    }

    process.stdout.write(
      'Backup PostgreSQL custom-format validado: ' + TABLES.length
      + ' tabelas verificadas; restauração isolada concluída.\n'
    );
  } finally {
    await Promise.allSettled([sourcePool?.end(), restorePool?.end()]);
    try {
      if (targetCreated) await adminPool.query('DROP DATABASE ' + RESTORE_DATABASE);
    } finally {
      await adminPool.end();
      if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }
}

verifyBackupRestore().catch((error) => {
  // Do not print connection strings, archive paths, SQL data, or subprocess stderr.
  const code = typeof error?.code === 'string' ? error.code : 'BACKUP_RESTORE_VERIFICATION_FAILED';
  process.stderr.write('Falha na verificação de backup/restauração: ' + code + '\n');
  process.exitCode = 1;
});
