# Generic Integration API

API independente para orquestrar operações com serviços externos, usando Node.js, JavaScript ES Modules e Arquitetura Hexagonal.

## Estado

Etapas 1 a 18 implementadas/revisadas tecnicamente: Domain, Application, Infrastructure, HTTP, PostgreSQL, Worker, reconciliação/observabilidade, endurecimento operacional, credenciais/autorização, ciclo de vida/quota, rate limiting distribuído, métricas/alertas, monitoramento centralizado e dashboard administrativo.

O projeto ainda **não está pronto para produção**: a implantação precisa configurar e validar os serviços gerenciados, executar migrations explicitamente, calibrar os limites de alerta por ambiente e integrar notificações externas/monitoramento centralizado.

## Instalação e execução

Requer Node.js 22 ou superior. O CI valida as linhas LTS 22, 24 e 26. Execute **npm ci**, copie **.env.example** para **.env**, configure um API_ACCESS_TOKEN aleatório com pelo menos 32 caracteres e inicie com **npm start**.

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

Execute **npm test** para Jest e testes Node.js. Para homologar serviços reais locais (PostgreSQL 16 e Redis 7) em uma base descartável chamada `stage17_homologation`, configure `DATABASE_URL`, `STAGING_ALLOW_DB_RESET=true`, `REDIS_HOST=127.0.0.1` e `REDIS_PORT=6379`, depois execute **npm run test:integration**. O teste recusa hosts fora de loopback e qualquer banco cujo nome não seja o da base de homologação.

O CI executa testes nas linhas Node.js 22/24/26 e um job separado de integração com PostgreSQL e Redis efêmeros. Para verificar backup/restauração na base temporária do CI, o job também executa `npm run verify:backup`, que exige exclusivamente o banco `stage17_homologation` em loopback. Confira o resultado real na aba Actions e consulte `docs/homologation-stage17.md` e `docs/backup-restore-rollback.md`.

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


## Segurança e prontidão para produção — Etapa 16

A configuração rejeita valores de `NODE_ENV` desconhecidos, segredos de exemplo, tokens com espaços e reutilização do mesmo segredo entre API master, Redis, métricas e webhook. Origens CORS em produção devem ser HTTPS. URLs de webhook não aceitam credenciais, query string ou fragmento.

As respostas de `/api/v1` usam `Cache-Control: no-store`, e o Express não confia em cabeçalhos de proxy por padrão. O CI executa testes nas linhas LTS 22, 24 e 26, auditoria de dependências com `npm audit` e verificação das fronteiras arquiteturais. O Dependabot acompanha atualizações de npm e GitHub Actions. Consulte `docs/security-review.md` antes de qualquer implantação.


## Homologação automatizada — Etapa 17

O job de homologação usa PostgreSQL 16 e Redis 7 efêmeros, aplica as migrations versionadas e exercita a API, credenciais, quotas, contadores Redis, readiness e os fluxos de retry/recuperação do worker. O adaptador do provedor é simulado para evitar efeitos colaterais externos; a homologação contra sandbox de cada provedor ainda depende das credenciais e endpoints da implantação. Veja `docs/homologation-stage17.md`.


## Revisão final e recuperação — Etapa 18

A rotina `npm run verify:backup` demonstra backup em formato custom do PostgreSQL e restauração em um segundo banco temporário isolado, comparando fingerprints de seis tabelas. Ela só aceita loopback, o nome de base `stage17_homologation` e `STAGING_ALLOW_DB_RESET=true`; não é uma rotina para produção. Consulte `docs/backup-restore-rollback.md` para política recomendada de backup gerenciado/PITR, verificação de restauração, RPO/RTO e rollback.

A atualização de `dotenv` para 18.0.10 foi incorporada. A auditoria npm de produção está limpa no limite moderado; permanecem 18 alertas moderados em ferramentas de desenvolvimento ligadas ao Jest, documentados sem forçar overrides de major potencialmente incompatíveis.

A conclusão técnica desta etapa não configura backup real, PITR, restauração real, domínio, TLS ou deploy. Esses itens continuam dependentes da infraestrutura escolhida.

## Implantação no Render — Etapa 19

A configuração inicial de hospedagem está em `render.yaml` e `docs/render-deployment.md`. Ela descreve dois serviços (API e worker) e um PostgreSQL gerenciado dedicado; somente Upstash e os segredos de integração precisam ser configurados externamente. O Blueprint não foi sincronizado e nenhum deploy foi realizado.
