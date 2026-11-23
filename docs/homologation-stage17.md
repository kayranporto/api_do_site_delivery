# Etapa 17 — Homologação automatizada

## O que esta etapa valida

O job `homologation` do GitHub Actions sobe serviços efêmeros e isolados para cada execução:

- PostgreSQL 16, com migrations reais 001–005.
- Redis 7, acessado pelo adaptador `UpstashRedisRateLimitStore` através de uma ponte REST restrita a `127.0.0.1`.
- API HTTP real, usando os repositórios PostgreSQL e o Redis efêmero.
- Worker real, consumindo uma tentativa de retry agendada no PostgreSQL e recuperando uma execução pendente antiga.

A suíte verifica readiness do banco e Redis, contador Redis partilhado por dois adapters, criação de credencial, escopo por integração, quota e HTTP 429, consumo diário, auditoria, revogação, retry até sucesso e recuperação para `interrupted`.

## Proteção contra produção

O teste recusa qualquer banco cujo host não seja loopback, cujo nome não seja exatamente `stage17_homologation` ou sem `STAGING_ALLOW_DB_RESET=true`. Antes de iniciar, ele executa `TRUNCATE` nas tabelas da base isolada. Nunca use as variáveis do ambiente de produção.

A ponte REST é código exclusivo de teste; não faz parte do servidor da API e não deve ser publicada ou implantada. Ela aceita somente PING, MGET e EVAL, exige token temporário, limita o corpo e escuta apenas em `127.0.0.1`.

O provedor externo é simulado por um adapter determinístico de teste: a primeira tentativa falha de forma transitória e a segunda funciona. Assim, a suíte valida o worker e o fluxo de retry sem enviar dados nem executar efeitos em terceiros.

## Executar localmente

Requisitos: Node.js 22+, PostgreSQL e Redis locais, além de `redis-cli` disponível no PATH. Crie previamente um banco descartável chamado `stage17_homologation`.

No PowerShell:

```powershell
$env:DATABASE_URL = "postgresql://stage17:senha-local@127.0.0.1:5432/stage17_homologation"
$env:STAGING_ALLOW_DB_RESET = "true"
$env:REDIS_HOST = "127.0.0.1"
$env:REDIS_PORT = "6379"
npm ci
npm run test:integration
```

O teste aplica as migrations 001–005 no banco descartável e limpa as tabelas de homologação antes de executar os cenários.

## Resultado e limites

O CI valida PostgreSQL e Redis locais efêmeros, não serviços externos gerenciados, TLS da hospedagem, firewall, DNS ou WAF. Também não substitui uma homologação com sandbox de cada provedor real. Essa parte depende dos endpoints de sandbox, contas de teste e segredos fornecidos pela implantação, e permanece pendente antes de produção.

Nenhum deploy, banco remoto, Redis externo, credencial real ou o repositório PedeJá é modificado por este teste.
