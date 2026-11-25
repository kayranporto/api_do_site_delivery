# Etapa 20 — Preparação para o primeiro deploy controlado

## Objetivo

Transformar o Blueprint da Etapa 19 em um procedimento de implantação verificável, com limites claros para evitar criação acidental de recursos pagos, exposição de segredos ou liberação prematura de tráfego.

Esta etapa prepara a implantação. **Ela não cria recursos no Render, não inicia cobrança, não configura a conta Upstash e não libera clientes.**

## Estado confirmado no repositório

- Branch de implantação: `main`.
- Blueprint: `render.yaml`.
- Serviços: `integration-api` (web) e `integration-api-worker` (background worker).
- Banco: PostgreSQL 16 dedicado, `integration-api-db`, na mesma região dos serviços.
- API e worker recebem a conexão privada do banco por `fromDatabase`.
- O pré-deploy executa `npm run db:migrate`; o migrador usa transação e advisory lock.
- A API usa Upstash Redis REST para rate limiting distribuído.
- O endpoint de health check do serviço web é `/readyz`.
- A execução CI mais recente da Etapa 19 terminou com sucesso nos três runtimes Node.js (22, 24 e 26) e no job de homologação PostgreSQL + Redis.

## Custo previsto antes de qualquer confirmação

Com os planos definidos no YAML, a referência de preços consultada em 25/11/2026 indica aproximadamente:

| Recurso | Plano | Estimativa mensal |
|---|---|---:|
| API web | `0.5c-512mb` | US$ 7 |
| Worker | `0.5c-512mb` | US$ 7 |
| PostgreSQL | `0.1c-256mb` | US$ 6 |
| **Base estimada** | | **US$ 20/mês** |

Esse valor não inclui Upstash, tráfego excedente, armazenamento adicional, impostos ou outros complementos. O valor exibido no painel do Render no momento da criação é o que deve ser considerado para a decisão final. Os planos e regiões não devem ser confirmados sem revisar o custo e a localização: a região dos recursos não pode ser alterada depois da criação.

## Pré-requisitos externos

Antes de abrir a criação do Blueprint:

- Ter acesso ao workspace Render que será proprietário da API.
- Ter uma conta Upstash e um banco Redis REST acessível pela região escolhida.
- Ter a URL HTTPS REST e o token Upstash disponíveis no gerenciador de segredos.
- Definir quem poderá acessar o dashboard administrativo e o endpoint Prometheus.
- Decidir se o primeiro deploy ficará isolado para homologação ou se haverá tráfego de produção.
- Ter uma origem HTTPS exata do frontend, caso acesso via navegador seja necessário. Enquanto ela não for conhecida, manter `CORS_ORIGINS` vazio.

Não envie credenciais, tokens, connection strings ou arquivos `.env` pelo chat, por issues ou por commits. Os valores devem ser inseridos diretamente nos campos de segredo do Render/Upstash.

## Procedimento de implantação

1. No Render, iniciar **New Blueprint** e conectar exclusivamente `kayranporto/api_do_site_delivery), branch `main`.
2. Conferir a prévia dos três recursos: API web, worker e PostgreSQL dedicado. Confirmar região, planos, nome do banco e custo mensal antes de aprovar.
3. Preencher `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN` quando o Render solicitar as variáveis marcadas com `sync: false`.
4. Confirmar que `API_ACCESS_TOKEN` e `METRICS_ACCESS_TOKEN` foram gerados separadamente. Não substituir um pelo outro.
5. Somente depois dessa revisão, sincronizar/criar o Blueprint.
6. Acompanhar os logs de build e pre-deploy da API e do worker. Ambos declaram a migration; o advisory lock do PostgreSQL serializa execuções concorrentes. Não iniciar tráfego se qualquer migration falhar.
7. Confirmar que a versão de schema esperada está aplicada e que o serviço web concluiu o startup.
8. Testar `/health` (liveness) e `/readyz` (readiness real de PostgreSQL e Redis). A prontidão só é aprovada com HTTP 200 em `/readyz`.
9. Confirmar nos logs que o worker iniciou e permanece ativo. Usar somente uma integração de teste controlada até validar credenciais e endpoints sandbox dos provedores.
10. Testar autenticação master, credencial individual, limites distribuídos, rotação/revogação, `/admin` e `/metrics` com credenciais separadas.
11. Configurar alertas externos, retenção de logs, backup/PITR e um procedimento de restauração verificado antes de liberar clientes.
12. Configurar `CORS_ORIGINS` com as origens HTTPS exatas, se aplicável. Nunca usar wildcard em produção.

## Critérios de liberação

A implantação só pode ser considerada pronta para receber tráfego externo quando todos os itens abaixo forem comprovados no ambiente criado:

- [ ] API e worker estão em execução estável.
- [ ] Todas as migrations foram aplicadas sem erro.
- [ ] `/health` e `/readyz` retornam HTTP 200.
- [ ] PostgreSQL usa a conexão privada do recurso dedicado desta API; nenhum banco do PedeJá foi reutilizado.
- [ ] Upstash está acessível e o rate limit é compartilhado entre instâncias.
- [ ] API master, métricas, Redis e webhook usam segredos distintos.
- [ ] Autenticação, escopos, quotas, rotação e revogação foram testados.
- [ ] O acesso a `/admin` e `/metrics` está restrito conforme a política operacional definida.
- [ ] Alertas externos estão recebendo eventos de teste.
- [ ] Backups/PITR e restauração foram verificados no banco real.
- [ ] Existe procedimento de rollback compatível com as migrations já aplicadas.
- [ ] CI está verde no commit exato que está implantado.

Um item pendente mantém a implantação em homologação; não deve ser tratado como aprovação parcial para produção.

## Rollback e recuperação

- Em falha de build ou startup, interromper a liberação de tráfego e usar os logs para corrigir a causa antes de novo deploy.
- Um rollback de código só deve ocorrer depois de confirmar compatibilidade da versão anterior com o schema atual. Não presumir que uma migration é reversível.
- Se houver inconsistência de dados, interromper o processamento do worker e seguir o procedimento de recuperação aprovado para o banco; não restaurar backup sem avaliar perda de dados e impacto nas execuções externas.
- Após recuperar, validar novamente schema, readiness, autenticação, quotas, worker e alertas.

## Pendências que exigem ação no painel

| Item | Responsável pela execução | Situação |
|---|---|---|
| Criar workspace/Blueprint no Render | Acesso do proprietário à conta Render | Pendente |
| Revisar e aceitar a cobrança estimada | Proprietário do workspace | Pendente |
| Criar/configurar Redis REST no Upstash | Acesso à conta Upstash | Pendente |
| Inserir os segredos no Render | Proprietário do workspace | Pendente |
| Executar primeiro deploy e smoke tests | Proprietário + revisão técnica | Pendente |
| Configurar backup/PITR e validar restauração | Proprietário do banco | Pendente |
| Configurar alertas, domínio e política de acesso | Proprietário da infraestrutura | Pendente |

## Resultado da Etapa 20

**Preparação documental concluída; implantação real bloqueada por pré-requisitos externos.**

Nenhum recurso pago foi criado e nenhuma credencial real foi compartilhada ou versionada. A próxima etapa é a criação controlada do Blueprint no Render, que deve começar somente após a revisão explícita de custos e a disponibilidade das credenciais do Upstash.
