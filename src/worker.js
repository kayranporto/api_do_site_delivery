import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createContainer } from './bootstrap/createContainer.js';
import { createPostgresPersistence } from './infrastructure/postgres/createPostgresPersistence.js';
import { loadWorkerConfig } from './infrastructure/configuration/loadWorkerConfig.js';
import { createWorker } from './worker/createWorker.js';

export async function startWorkerProcess({ config = loadWorkerConfig(), logger = console } = {}) {
  const persistence = await createPostgresPersistence({
    connectionString: config.databaseUrl,
    max: config.databasePoolMax
  });
  try {
    const container = createContainer({
      repositories: persistence.repositories,
      executionLeaseMs: config.leaseMs,
      staleAfterMs: config.staleAfterMs
    });
    const worker = createWorker({
      useCases: container.useCases,
      intervalMs: config.intervalMs,
      batchSize: config.batchSize,
      staleBatchSize: config.staleBatchSize,
      staleAfterMs: config.staleAfterMs,
      logger
    });

    let closed = false;
    return {
      worker,
      async runOnce() { return worker.runOnce(); },
      async start() { await worker.start({ immediate: true }); },
      async close() {
        if (closed) return;
        closed = true;
        await worker.stop();
        await persistence.close();
      }
    };
  } catch (error) {
    await persistence.close();
    throw error;
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const once = process.argv.includes('--once');
  startWorkerProcess().then(async (running) => {
    if (once) {
      try { await running.runOnce(); } finally { await running.close(); }
      return;
    }
    let shuttingDown = false;
    const shutdown = () => {
      if (shuttingDown) return;
      shuttingDown = true;
      running.close().catch(() => {
        process.stderr.write('Falha ao encerrar o worker com segurança.\n');
        process.exitCode = 1;
      });
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    await running.start();
    if (!shuttingDown) process.stdout.write('Worker iniciado.\n');
  }).catch((error) => {
    process.stderr.write(error.message + '\n');
    process.exitCode = 1;
  });
}
