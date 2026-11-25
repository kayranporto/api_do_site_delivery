# Etapa 19 — implantação no Render

## Escopo desta configuração

O arquivo `render.yaml` descreve dois serviços Node.js independentes:

- `integration-api`: serviço web que executa `npm start`.
- `integration-api-worker`: worker contínuo que executa `npm run worker`.

Ambos usam a mesma versão do repositório, Node.js 22 ou superior e PostgreSQL compartilhado. A API também usa Upstash Redis REST para quotas distribuídas. O worker não recebe tráfego público.

O Blueprint cria um PostgreSQL gerenciado dedicado para esta API, na região Virginia, e injeta a conexão privada automaticamente nos dois serviços por `fromDatabase`. O banco é isolado para conexões internas do Render (`ipAllowList: []`); não reutilize o banco do projeto PedeJá. O Redis continua externo: `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN` são solicitados na configuração inicial.

## Recursos e custos do compute

Os dois serviços estão configurados inicialmente na região `virginia`, com plano `0.5c-512mb` para API e worker. A tabela atual informa US$ 7/mês por serviço nesse plano e US$ 6/mês para o PostgreSQL de entrada (`0.1c-256mb`); portanto, o custo-base previsto dos dois serviços mais o banco começa em aproximadamente **US$ 20/mês**, antes de Redis, armazenamento adicional, uso de pipeline, tráfego, tributos e outros custos. O plano de worker é pago: Render não oferece instâncias gratuitas para background workers. Consulte os preços antes de sincronizar o Blueprint.

A região dos serviços e do banco não pode ser alterada depois que os recursos são criados. O PostgreSQL usa o plano mínimo pago de 256 MB RAM, 0,1 CPU e limite de 100 conexões; é uma configuração inicial econômica, não uma recomendação de capacidade para carga alta. Monitore memória, conexões e latência e faça upgrade antes de saturar. O banco gratuito não foi escolhido porque expira após 30 dias. O Upstash deve ser configurado e a região/latência do Redis validada antes de liberar tráfego.

## Variáveis de ambiente

### API

- `NODE_ENV=production`
- `HOST=0.0.0.0`; Render injeta a porta HTTP em `PORT`.
- `CLIENT_IP_HEADER=cf-connecting-ip` para rate limit individual por IP no Render.
- `DATABASE_URL`: conexão privada gerada automaticamente pelo Render Postgres Blueprint.
- `RATE_LIMIT_STORE=upstash`
- `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN`: credenciais REST do Upstash.
- `API_ACCESS_TOKEN` e `METRICS_ACCESS_TOKEN`: gerados individualmente pelo Render no Blueprint.
- `CORS_ORIGINS`: vazio inicialmente. Antes de permitir acesso de navegador, preencher com cada origem HTTPS exata do frontend, sem wildcard e sem caminhos.

### Worker

O worker recebe a mesma conexão privada diretamente do recurso PostgreSQL via `fromDatabase` e usa os parâmetros `WORKER_*` descritos no YAML. Não precisa de token master da API nem de credenciais Redis REST.

Nunca coloque valores secretos neste arquivo, no Git, em issues ou em logs. O Render disponibiliza o preenchimento de valores marcados com `sync: false` durante a primeira criação do Blueprint. Para alterações futuras, use o painel Environment do Render.

## IP do cliente e cabeçalhos do proxy

O Express continua com `trust proxy=false`. O Render informa que o tráfego de serviços web passa pela camada Cloudflare. O código usa somente `CF-Connecting-IP` para a chave do limitador, validando um único endereço IPv4 ou IPv6. Não usa `X-Forwarded-For`, que pode conter valores encaminhados pelo cliente. Se o cabeçalho confiável estiver ausente ou malformado, a requisição não segue pelo rate limiter.

O header precisa ser fornecido pela borda do Render/Cloudflare. Confirme a origem IP com chamadas de teste no ambiente hospedado antes de liberar clientes externos. Referência: [Como o Render lida com ataques DDoS](https://render.com/articles/how-render-handles-ddos-attacks), [nota do Render sobre o cabeçalho CF-Connecting-IP](https://render.com/articles/host-pocketbase-on-render) e [guia do Express atrás de proxies](https://expressjs.com/en/guide/behind-proxies/).

## Migrations e prontidão

Os dois serviços declaram `preDeployCommand: npm run db:migrate`. O script existente aplica as migrations dentro de uma transação e usa advisory transaction lock do PostgreSQL. Portanto, execuções concorrentes ficam serializadas e uma execução posterior não reaplica versões já registradas. Esse comando de pre-deploy requer plano pago do Render.

A API usa `/readyz` como health check: só responde saudável quando PostgreSQL e Upstash estão acessíveis. `/health` continua como liveness simples. O worker não expõe endpoint HTTP.

O worker recebe 180 segundos para encerrar após SIGTERM, alinhado ao lease padrão de três minutos. Não aumente `WORKER_LEASE_MS` sem rever o tempo máximo de shutdown e os tempos limite dos provedores.

## Passos de configuração no painel

1. Criar ou selecionar uma conta/workspace Render e abrir Blueprint/New Blueprint.
2. Conectar somente o repositório `kayranporto/api_do_site_delivery` e selecionar o branch `main`.
3. Revisar os dois serviços e o banco PostgreSQL (plano mínimo pago) antes de confirmar. A criação dos recursos inicia cobrança conforme os planos selecionados.
4. Preparar Upstash e preencher URL REST HTTPS e token. O PostgreSQL dedicado é criado pelo Blueprint; não use nem conecte as credenciais do banco do PedeJá.
5. Confirmar que Render gerou tokens separados para API e métricas.
6. Preencher `CORS_ORIGINS` com as origens HTTPS corretas antes de integrar um frontend de navegador.
7. Conferir CI verde e logs de build/pre-deploy; validar `/health`, `/readyz`, autenticação e rate limiting com dois IPs diferentes.
8. Confirmar backup/PITR e restauração no banco gerenciado, configurar alertas externos e revisar restrições para `/admin` e `/metrics`.
9. Só então considerar a API liberada para clientes.

## Estado e limites

Esta configuração é um Blueprint versionado, não uma implantação. Nenhum serviço ou banco Render foi criado, nenhuma cobrança foi iniciada, nenhuma URL ou segredo real foi adicionado e nenhuma migration foi aplicada a banco remoto. Domínio próprio, proteção de rede para dashboard/rotas administrativas, backups/PITR, RPO/RTO e sandbox de provedores ainda precisam ser preparados e aprovados.
