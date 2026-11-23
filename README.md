# Generic Integration API

API independente para orquestrar operações com serviços externos, usando Node.js, JavaScript ES Modules e Arquitetura Hexagonal.

## Estado

Etapas 1 (Domain), 2 (Application), 3 (Infrastructure), 4 (Interface HTTP), 5 (Persistência PostgreSQL), 6 (Worker), 7 (Reconciliação e observabilidade), 8 (Endurecimento operacional inicial), 9 (Credenciais e autorização), 10 (Ciclo de vida e quotas de credenciais) e 11 (Rate limiting distribuído e consumo por cliente) implementadas.

O projeto ainda **não está pronto para produção**: a implantação precisa configurar e validar os serviços gerenciados, executar migrations explicitamente, concluir hardening operacional e definir alertas e controles do ambiente.

## Instalação e execução

Requer Node.js 20 ou superior. Execute **npm ci**, copie **.env.example** para **.env**, configure um API_ACCESS_TOKEN aleatório com pelo menos 32 caracteres e inicie com **npm start**.

Sem DATABASE_URL, o modo local usa repositórios em memória e perde os dados ao reiniciar. O rate limit local também usa memória e não coordena processos diferentes.

## Worker e retries automáticos

Com PostgreSQL configurado e o schema atualizado, execute o worker em processo separado:

- **npm run worker** inicia o polling contínuo.
- **npm run worker:once** executa um ciclo e encerra.

O worker recupera execuções antigas e processa retries vencidos. Ele aguarda o ciclo ativo antes de fechar conexões ao receber SIGINT ou SIGTERM. As variáveis WORKER_* configuram intervalo, lotes, limite de antiguidade e lease; consulte docs/worker-design.md.

Execuções interrompidas ficam em estado **interrupted** e podem ser consultadas manualmente com POST /api/v1/executions/:executionId/reconcile, desde que o provedor tenha um endpoint de consulta configurado. O resultado é registrado como evento, mas não altera o estado original nem dispara retries.

## PostgreSQL

Configure DATABASE_URL e DATABASE_POOL_MAX no arquivo .env. Antes de iniciar a API pela primeira vez, aplique a migration de forma explícita com **npm run db:migrate**. Depois, inicie com **npm start**.

O servidor verifica a versão do schema, mas não aplica migrations automaticamente. Em NODE_ENV=production, DATABASE_URL é obrigatório. A migration 004 cria as tabelas de credenciais e auditoria de clientes.

## Rate limiting compartilhado

Em desenvolvimento, **RATE_LIMIT_STORE=memory** mantém os contadores no processo. Para várias réplicas e para produção, configure **RATE_LIMIT_STORE=upstash**, **UPSTASH_REDIS_REST_URL** e **UPSTASH_REDIS_REST_TOKEN**. O servidor exige o Redis compartilhado em NODE_ENV=production e falha fechado quando o armazenamento não está disponível.

O limite geral por IP continua antes da autenticação. Depois da autenticação, cada credencial individual recebe sua quota própria, compartilhada entre instâncias. A credencial master não usa a quota individual, mas continua sob o limite geral por IP.

As chamadas autenticadas por credencial individual geram contagens diárias no Redis, retidas por 35 dias. A master consulta **GET /api/v1/clients/:clientId/usage?days=30** para visualizar até 30 dias de consumo. Isso é telemetria de requisições, não faturamento nem quota mensal. Consulte docs/rate-limiting-usage.md e docs/production-hardening.md.

## Credenciais de cliente

Use a credencial master para criar chaves individuais em **POST /api/v1/clients**. A chave bruta é exibida somente na criação e na rotação; o banco mantém apenas o hash. Por padrão, uma nova chave expira em 90 dias. Configure **expiresInDays**, **rateLimitMax** e **rateLimitWindowMs** no corpo da criação. Use **POST /api/v1/clients/:clientId/rotate** para trocar a chave (a anterior é invalidada imediatamente), **POST /api/v1/clients/:clientId/limits** para ajustar quotas, **POST /api/v1/clients/:clientId/revoke** para revogar, **GET /api/v1/clients/:clientId/audit** para consultar eventos e **GET /api/v1/clients/:clientId/usage** para consultar consumo diário. Consulte docs/authentication-authorization.md.

Campo **integrationIds** omitido significa nenhum acesso a integrações; uma lista limita a IDs específicos; **null** dá acesso global. A criação de integrações e a gestão de credenciais permanecem exclusivas da master.

## Testes

Execute **npm test** para Jest e testes Node.js. O workflow do GitHub Actions executa npm ci e npm test em pushes e pull requests para main. Confira o resultado real na aba Actions.

## Estrutura

- src/domain: entidades, Value Objects, erros e portas.
- src/application: casos de uso e contratos de saída.
- src/infrastructure: repositórios em memória e PostgreSQL, provedores, rate limiting e adaptadores HTTP.
- database/migrations: schema versionado do PostgreSQL.
- src/bootstrap: composição de dependências.
- src/server.js: inicialização do servidor Express.
- tests: testes Node.js e Jest.
- docs: decisões das camadas, contrato HTTP, persistência e operação.

Consulte docs/http-api.md, docs/persistence-design.md, docs/reconciliation-observability.md, docs/production-hardening.md, docs/rate-limiting-usage.md e docs/authentication-authorization.md para rotas, exemplos e limites operacionais.
