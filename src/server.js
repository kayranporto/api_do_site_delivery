import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createContainer } from './bootstrap/createContainer.js';
import { loadConfig } from './infrastructure/configuration/loadConfig.js';
import { createHttpApp } from './infrastructure/http/createHttpApp.js';

export function buildHttpApplication({ config = loadConfig(), container = createContainer({
  providerConfigurations: config.providerConfigurations
}) } = {}) {
  const app = createHttpApp({
    useCases: container.useCases,
    apiAccessToken: config.apiAccessToken,
    corsOrigins: config.corsOrigins
  });
  return { app, container };
}

export function startServer({ config = loadConfig(), container } = {}) {
  const application = buildHttpApplication({ config, container });
  const server = application.app.listen(config.port, config.host, () => {
    process.stdout.write(`API listening on http://${config.host}:${config.port}\n`);
  });

  return { ...application, server };
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  try {
    startServer();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
