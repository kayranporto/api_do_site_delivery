# Generic Integration API

API independente para orquestrar operações com serviços externos, usando Node.js, JavaScript ES Modules e Arquitetura Hexagonal.

## Estado

Etapas 1 a 14 implementadas: Domain, Application, Infrastructure, HTTP, PostgreSQL, Worker, reconciliação/observabilidade, endurecimento operacional, credenciais/autorização, ciclo de vida/quota, rate limiting distribuído, métricas/alertas, monitoramento centralizado e dashboard administrativo.

O projeto ainda **não está pronto para produção**: a implantação precisa configurar e validar os serviços gerenciados, executar migrations explicitamente, calibrar os limites de alerta por ambiente e integrar notificações externas/monitoramento centralizado.

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

## Monitoramento e alertas

- **GET /health**: liveness do processo.
- **GET /readyz**: readiness dos serviços configurados; verifica PostgreSQL e Redis com consultas/ping reais e devolve 503 quando algum estiver indisponível.
- **GET /api/v1/observability/performance?windowMinutes=5**: contagem HTTP, status, taxa 5xx/429, latência média/p50/p95/máxima, rotas, uso de memória e CPU do processo.
- **GET /api/v1/observability/alerts?windowMinutes=5**: avalia regras configuráveis de p95, erro 5xx, respostas 429 e RSS.

Os endpoints de observabilidade exigem escopo global `observability:read`; chaves restritas por integração não podem consultar agregados globais. As métricas HTTP são locais à instância, guardam no máximo 10.000 amostras recentes, usam templates de rota (não IDs, IPs, payloads ou query strings) e são perdidas ao reiniciar. A rota `/metrics` oferece exposição Prometheus protegida por credencial separada. Quando `ALERT_WEBHOOK_URL` está configurada, o monitor envia eventos de início, lembrete e recuperação com deduplicação e cooldown. Consulte docs/monitoring-alerts.md.

As variáveis `OBSERVABILITY_WINDOW_MINUTES`, `ALERT_MIN_REQUESTS`, `ALERT_P95_LATENCY_MS`, `ALERT_ERROR_RATE_PERCENT`, `ALERT_429_RATE_PERCENT`, `ALERT_RSS_MB`, `ALERT_NOTIFICATION_INTERVAL_MS` e `ALERT_NOTIFICATION_COOLDOWN_MS` controlam janela, limites e cadência dos alertas. Em produção, configure também `METRICS_ACCESS_TOKEN` para scraping e, quando desejar notificações diretas, `ALERT_WEBHOOK_URL` (HTTPS) e opcionalmente `ALERT_WEBHOOK_TOKEN`.

## Dashboard administrativo

Acesse **/admin** no mesmo host da API para abrir o painel de monitoramento. Entre usando a credencial master `API_ACCESS_TOKEN`. A interface apresenta readiness, métricas HTTP, alertas atuais e histórico recente, consumo de clientes e resumo de execuções/eventos.

O token é mantido somente na memória da página; ele não é salvo em `localStorage` nem `sessionStorage` e é apagado ao sair ou recarregar. A API valida cada chamada administrativa no servidor. O acesso de navegador deve usar HTTPS em produção e a credencial master nunca deve ser compartilhada ou embutida no frontend.

O painel atualiza automaticamente a cada 30 segundos. O histórico de alertas é limitado a 100 eventos em memória na instância e não é persistente nem compartilhado entre réplicas. Consulte docs/admin-dashboard.md.

## Credenciais de cliente

Use a credencial master para criar chaves individuais em **POST /api/v1/clients**. A chave bruta é exibida somente na criação e na rotação; o banco mantém apenas o hash. Por padrão, uma nova chave expira em 90 dias. Configure **expiresInDays**, **rateLimitMax** e **rateLimitWindowMs** no corpo da criação. Use **POST /api/v1/clients/:clientId/rotate** para trocar a chave (a anterior é invalidada imediatamente), **POST /api/v1/clients/:clientId/limits** para ajustar quotas, **POST /api/v1/clients/:clientId/revoke** para revogar, **GET /api/v1/clients/:clientId/audit** para consultar eventos e **GET /api/v1/clients/:clientId/usage** para consultar consumo diário. Consulte docs/authentication-authorization.md.

Campo **integrationIds** omitido significa nenhum acesso a integrações; uma lista limita a IDs específicos; **null** dá acesso global. A criação de integrações e a gestão de credenciais permanecem exclusivas da master.

## Testes

Execute **npm test** para Jest e testes Node.js. O workflow do GitHub Actions executa npm ci e npm test em pushes e pull requests para main. Confira o resultado real na aba Actions.

## Estrutura

- src/domain: entidades, Value Objects, erros e portas.
- src/application: casos de uso e contratos de saída.
- src/infrastructure: repositórios em memória e PostgreSQL, provedores, rate limiting, observabilidade HTTP, exportação Prometheus e notificações webhook.
- database/migrations: schema versionado do PostgreSQL.
- src/bootstrap: composição de dependências.
- src/server.js: inicialização do servidor Express.
- tests: testes Node.js e Jest.
- docs: decisões das camadas, contrato HTTP, persistência e operação.

Consulte docs/http-api.md, docs/persistence-design.md, docs/reconciliation-observability.md, docs/production-hardening.md, docs/rate-limiting-usage.md, docs/monitoring-alerts.md, docs/admin-dashboard.md e docs/authentication-authorization.md para rotas, exemplos e limites operacionais.
