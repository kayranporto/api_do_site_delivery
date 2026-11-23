# Generic Integration API

API independente para orquestrar operações com serviços externos, usando Node.js, JavaScript ES Modules e Arquitetura Hexagonal.

## Estado

Etapas 1 (Domain), 2 (Application), 3 (Infrastructure), 4 (Interface HTTP), 5 (Persistência PostgreSQL), 6 (Worker), 7 (Reconciliação e observabilidade), 8 (Endurecimento operacional inicial) e 9 (Credenciais e autorização) implementadas. O projeto ainda **não está pronto para produção**: o rate limiting local não é distribuído, a credencial master conserva acesso global e faltam expiração/rotação automática, alertas e controles específicos do ambiente.

## Instalação e execução

Requer Node.js 20 ou superior. Execute **npm ci**, copie **.env.example** para **.env**, configure um API_ACCESS_TOKEN aleatório com pelo menos 32 caracteres e inicie com **npm start**.

Sem DATABASE_URL, o modo local usa repositórios em memória e perde os dados ao reiniciar.

## Worker e retries automáticos

Com PostgreSQL configurado e o schema atualizado, execute o worker em processo separado:

- **npm run worker** inicia o polling contínuo.
- **npm run worker:once** executa um ciclo e encerra.

O worker recupera execuções antigas e processa retries vencidos. Ele aguarda o ciclo ativo antes de fechar conexões ao receber SIGINT ou SIGTERM. As variáveis WORKER_* configuram intervalo, lotes, limite de antiguidade e lease; consulte docs/worker-design.md.

Execuções interrompidas ficam em estado **interrupted** e podem ser consultadas manualmente com POST /api/v1/executions/:executionId/reconcile, desde que o provedor tenha um endpoint de consulta configurado. O resultado é registrado como evento, mas não altera o estado original nem dispara retries.

## PostgreSQL

Configure DATABASE_URL e DATABASE_POOL_MAX no arquivo .env. Antes de iniciar a API pela primeira vez, aplique a migration de forma explícita com **npm run db:migrate**. Depois, inicie com **npm start**.

O servidor verifica a versão do schema, mas não aplica migrations automaticamente. Em NODE_ENV=production, DATABASE_URL é obrigatório. A migration 004 cria as tabelas de credenciais e auditoria de clientes.

## Configuração

- **API_ACCESS_TOKEN**: credencial master (mínimo 32 caracteres); mantenha em cofre de segredos e não a entregue aos consumidores.
- **HOST**: por padrão 127.0.0.1.
- **PORT**: por padrão 3000.
- **NODE_ENV**: development por padrão; production exige PostgreSQL.
- **CORS_ORIGINS**: origens exatas separadas por vírgula; sem wildcard.
- **RATE_LIMIT_WINDOW_MS** e **RATE_LIMIT_MAX**: janela e quantidade de requisições por IP; padrões 60000 ms e 120.
- **PROVIDER_CONFIG_JSON**: objeto JSON com configurações dos provedores.
- **DATABASE_URL**: URL PostgreSQL opcional em desenvolvimento, obrigatória em produção.
- **DATABASE_POOL_MAX**: limite de conexões (1–50, padrão 10).
- Segredos de provedores são referenciados como env:NOME_DA_VARIAVEL; não grave valores secretos no Git.

O rate limiter é local ao processo. Em implantação com várias réplicas, configure limite compartilhado no gateway/WAF ou Redis. Consulte docs/production-hardening.md.

## Credenciais de cliente

Use a credencial master para criar chaves individuais em **POST /api/v1/clients**. A chave bruta é exibida somente na resposta de criação; o banco mantém apenas o hash. Atribua apenas os escopos e IDs de integração necessários. Use **POST /api/v1/clients/:clientId/revoke** para revogar uma chave e **GET /api/v1/clients/:clientId/audit** para consultar eventos administrativos e de autenticação. Consulte docs/authentication-authorization.md.

Campo `integrationIds` omitido significa nenhum acesso a integrações; uma lista limita a IDs específicos; `null` dá acesso global. A criação de integrações e a gestão de credenciais permanecem exclusivas da master.

## Testes

Execute **npm test** para Jest e testes Node.js. O workflow do GitHub Actions executa npm ci e npm test em pushes e pull requests para main. Confira o resultado real na aba Actions.

## Estrutura

- src/domain: entidades, Value Objects, erros e portas.
- src/application: casos de uso e contratos de saída.
- src/infrastructure: repositórios em memória e PostgreSQL, provedores e adaptadores HTTP.
- database/migrations: schema versionado do PostgreSQL.
- src/bootstrap: composição de dependências.
- src/server.js: inicialização do servidor Express.
- tests: testes Node.js e Jest.
- docs: decisões das camadas, contrato HTTP e persistência.

Consulte docs/http-api.md, docs/persistence-design.md, docs/reconciliation-observability.md, docs/production-hardening.md e docs/authentication-authorization.md para rotas, exemplos e limites operacionais.
