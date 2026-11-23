# Endurecimento operacional

## Rate limiting HTTP e quotas

O middleware aplica limite fixo por IP em /api/v1, antes da autenticação e do parser JSON. O padrão é 120 requisições por janela de 60 segundos. Respostas 429 incluem Retry-After e cabeçalhos X-RateLimit. A configuração pode ser ajustada por RATE_LIMIT_WINDOW_MS e RATE_LIMIT_MAX.

Depois da autenticação, credenciais individuais recebem uma quota separada, definida por rate_limit_max e rate_limit_window_ms no registro da credencial. A credencial master não usa a quota individual, mas continua protegida pelo limite geral por IP.

Em desenvolvimento, RATE_LIMIT_STORE=memory usa memória limitada do processo. Esse modo não coordena réplicas e reinicia os contadores quando o processo reinicia. Em produção, RATE_LIMIT_STORE=upstash é obrigatório; o adaptador usa Redis pela API REST do Upstash e scripts Lua atômicos para compartilhar os contadores entre instâncias. Se o Redis não responder, as requisições /api/v1 falham fechadas com erro de serviço, em vez de ignorar a proteção.

A contagem diária por credencial individual é mantida no Redis com expiração de 35 dias. A rota GET /api/v1/clients/:clientId/usage?days=30, exclusiva da master, apresenta resumo diário até 30 dias. São contagens de requisições recebidas no limitador individual, inclusive as tentativas que excederam a quota; chamadas bloqueadas anteriormente pelo limite geral por IP não entram no resumo. O histórico do modo memory desaparece com o processo e não deve ser usado para auditoria financeira.

O Redis compartilhado não substitui proteção contra DDoS, WAF, controle de egress, limites no gateway ou monitoramento externo. Não habilite trust proxy sem definir explicitamente os proxies confiáveis; caso contrário, o IP pode ser falsificado por cabeçalhos encaminhados.

## CI

O workflow .github/workflows/ci.yml executa npm ci e npm test em push para main e pull requests direcionados a main, usando Node.js 20. A existência do workflow não significa que a execução já passou: confira o status em Actions após o push.

## Retenção dos eventos

A tabela execution_events é append-only pela aplicação. A política de retenção depende de requisitos legais, contratuais e de auditoria da implantação. Antes de habilitar expurgo, defina prazo, aprovação, backup e trilha de auditoria. Não foi criada rotina de exclusão automática nesta etapa.

## Monitoramento e alertas — Etapa 12

O middleware coleta métricas HTTP concluídas por instância: volume, status 4xx/5xx/429, latência média, p50, p95 e máxima, distribuição pelas rotas Express, uso de memória RSS/heap e estimativa de CPU do processo. O buffer é limitado a 10.000 amostras. Os nomes de rota são templates do Express; requisições sem rota usam o rótulo `_unmatched`, sem armazenar path, query, payload, IP, headers ou credenciais.

`GET /readyz` executa checks configurados para PostgreSQL (`SELECT 1`) e Redis (`PING`), devolvendo 503 sem detalhes de exceção quando uma dependência está indisponível. `/health` permanece como liveness do processo e não verifica dependências.

`GET /api/v1/observability/performance?windowMinutes=5` expõe métricas de 1 a 60 minutos. `GET /api/v1/observability/alerts?windowMinutes=5` avalia limites de p95, proporção de 5xx, proporção de 429 e RSS. Ambos exigem escopo global `observability:read`. Os limites podem ser ajustados pelas variáveis ALERT_* e pela janela padrão OBSERVABILITY_WINDOW_MINUTES.

Os dados são efêmeros e locais ao processo: cada réplica tem seu próprio buffer e reiniciar a aplicação remove as amostras. Os alertas são avaliados periodicamente quando o webhook está configurado; a entrega usa deduplicação e cooldown em memória da instância. Para monitoramento multi-instância, retenção e acionamento, encaminhe métricas para Prometheus/OpenTelemetry ou um serviço central e integre um canal de alertas externo.

## Exportação e notificações — Etapa 13

A rota `GET /metrics` publica a janela móvel em Prometheus exposition format 0.0.4. Ela exige `Authorization: Bearer <METRICS_ACCESS_TOKEN>`, token exclusivo com pelo menos 32 caracteres; a credencial master não substitui esse token. Em produção, a configuração exige `METRICS_ACCESS_TOKEN`. Configure o Prometheus para fazer scrape de cada réplica e proteger o segredo no cofre de credenciais.

Quando `ALERT_WEBHOOK_URL` está configurada, a aplicação verifica alertas periodicamente e envia JSON estruturado para um endpoint HTTPS. `ALERT_WEBHOOK_TOKEN` é opcional e enviado somente no header Authorization. O monitor deduplica por código, envia lembretes após o cooldown e informa recuperação. Falhas são tentadas novamente no próximo ciclo. Redirecionamentos HTTP são recusados.

A URL do webhook é uma configuração de saída: restrinja egress/firewall para os destinos aprovados e não use endpoints controlados por usuários da API. O payload não inclui payloads das operações, IPs, tokens, headers ou credenciais.

## Limitações remanescentes

- A telemetria de consumo do Upstash tem retenção de 35 dias e não é um livro contábil nem uma fonte de faturamento.
- A credencial master permanece global e deve ser mantida fora das aplicações consumidoras; chaves individuais têm escopos e allowlists de integração.
- /health é uma verificação de processo, não uma prova de prontidão do banco, do worker ou do Redis.
- O buffer de métricas e a deduplicação do monitor permanecem locais a cada processo; não há agregação entre réplicas nem histórico durável de incidentes.
- O webhook envia um formato JSON genérico; não há formatação específica para Slack/Discord nem dashboard, SIEM ou exporter OTLP.
- A implantação ainda precisa de TLS, firewall/egress, gestão/rotação de segredos, backup PostgreSQL e monitoramento externo.


## Dashboard administrativo — Etapa 14

A rota `/admin` entrega os arquivos estáticos do console administrativo. O conteúdo estático não contém dados nem segredos; as consultas protegidas continuam exigindo credencial master. O frontend mantém o token somente na memória da aba, não o grava em storage e o apaga em logout/reload. Os arquivos usam a política de segurança de conteúdo do Helmet e os valores retornados são adicionados ao DOM por `textContent`, sem interpolar dados da API como HTML.

O dashboard consome dados dos endpoints protegidos de clientes, consumo, métricas e observabilidade, além de `/readyz`. Ele atualiza a cada 30 segundos, e permite refresh manual e logout.

A rota `GET /api/v1/observability/alerts/history?limit=50` é exclusiva da master; aceita 1 a 100 entradas e devolve `meta.retention=process_memory`. O histórico contém transições firing/resolved e lembretes do monitor, tem capacidade máxima de 100 eventos por instância e é apagado quando o processo reinicia. Não substitui um registro persistente ou compartilhado.

Em produção, exponha o painel somente sobre HTTPS e, preferencialmente, restrinja `/admin` e as rotas administrativas por VPN, allowlist de IP ou proxy de identidade. A credencial master concede acesso global à API; utilize-a somente em estação administrativa confiável, não a distribua a clientes e faça logout ao encerrar a sessão.


## Segurança e prontidão — Etapa 16

A inicialização aceita apenas `NODE_ENV=development`, `test` ou `production`. Segredos de exemplo, valores com espaços e segredos reutilizados entre API master, Redis, métricas e webhook são recusados. Em produção, origens CORS configuradas devem usar HTTPS. URLs de webhook não aceitam query string: coloque qualquer segredo no header Authorization.

Todas as respostas de `/api/v1`, incluindo falhas de autenticação, recebem `Cache-Control: no-store`. O Express declara `trust proxy=false`; não confie em `X-Forwarded-For` enviado diretamente por clientes. Antes de habilitar a aplicação atrás de proxy, defina uma lista explícita de proxies confiáveis e teste os endereços vistos pelo rate limiter.

O workflow executa em Node.js 22, 24 e 26, faz `npm audit --audit-level=high`, verifica as fronteiras arquiteturais e roda os testes. As actions do workflow usam versões com runtime Node 24, e o checkout não persiste a credencial Git. Dependabot acompanha semanalmente dependências npm e actions.

Consulte `docs/security-review.md` para o checklist de implantação e limitações que ainda dependem da infraestrutura real.
