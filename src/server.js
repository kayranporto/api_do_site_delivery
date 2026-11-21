import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createContainer } from './bootstrap/createContainer.js';
import { createPostgresPersistence } from './infrastructure/postgres/createPostgresPersistence.js';
import { loadConfig } from './infrastructure/configuration/loadConfig.js';
import { createHttpApp } from './infrastructure/http/createHttpApp.js';

export async function buildHttpApplication({ config = loadConfig(), container } = {}) {
  let activeContainer = container;
  let closePersistence = async () => {};

  if (!activeContainer) {
    let repositories;
    if (config.databaseUrl) {
      const persistence = await createPostgresPersistence({
        connectionString: config.databaseUrl,
        max: config.databasePoolMax
      });
      repositories = persistence.repositories;
      closePersistence = persistence.close;
    } else if (config.nodeEnv === 'production') {
      throw new Error('Persistência PostgreSQL é obrigatória em produção.');
    }

    activeContainer = createContainer({
      providerConfigurations: config.providerConfigurations,
      repositories: repositories ?? {},
      executionLeaseMs: config.workerLeaseMs,
      staleAfterMs: config.workerStaleAfterMs
    });
  }

  const app = createHttpApp({
    useCases: activeContainer.useCases,
    apiAccessToken: config.apiAccessToken,
    corsOrigins: config.corsOrigins,
    rateLimitWindowMs: config.rateLimitWindowMs,
    rateLimitMax: config.rateLimitMax
  });

  return { app, container: activeContainer, close: closePersistence };
}

export async function startServer({ config = loadConfig(), container } = {}) {
  const application = await buildHttpApplication({ config, container });
  const server = application.app.listen(config.port, config.host);

  try {
    await new Promise((resolveListen, rejectListen) => {
      server.once('error', rejectListen);
      server.once('listening', () => {
        server.off('error', rejectListen);
        process.stdout.write('API listening on http://' + config.host + ':' + config.port + '\n');
        resolveListen();
      });
    });
  } catch (error) {
    await application.close();
    throw new Error('Não foi possível iniciar o servidor HTTP.', { cause: error });
  }

  return {
    ...application,
    server,
    async close() {
      await new Promise((resolveClose, rejectClose) => {
        server.close((error) => error ? rejectClose(error) : resolveClose());
      });
      await application.close();
    }
  };
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  startServer().then((running) => {
    let shuttingDown = false;
    const shutdown = () => {
      if (shuttingDown) return;
      shuttingDown = true;
      running.close().catch(() => {
        process.stderr.write('Falha ao encerrar o servidor com segurança.\n');
        process.exitCode = 1;
      });
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  }).catch((error) => {
    process.stderr.write(error.message + '\n');
    process.exitCode = 1;
  });
}
