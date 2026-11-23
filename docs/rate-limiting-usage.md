# Etapa 11 — Rate limiting distribuído e consumo por cliente

## Componentes

A porta de armazenamento de rate limit oferece duas implementações:

- **InMemoryRateLimitStore**: modo local e testes. Os buckets e o histórico existem apenas no processo.
- **UpstashRedisRateLimitStore**: Redis compartilhado pela API REST do Upstash. Não requer SDK adicional; usa fetch nativo do Node.js 20.

O adaptador executa um script Lua com EVAL. O incremento da janela, a atribuição do TTL e o registro do consumo diário acontecem na mesma operação atômica do Redis. Duas ou mais instâncias da API que usem o mesmo banco Upstash compartilham o mesmo contador. As chaves Redis são derivadas de SHA-256 dos identificadores, sem gravar IP ou ID de cliente em texto claro no nome da chave.

## Ordem dos middlewares

1. Limite geral por IP, antes da autenticação.
2. Autenticação da credencial.
3. Quota individual da credencial, antes do parser JSON e da auditoria de autenticação.
4. Auditoria de autenticação e parser JSON.

Credenciais master ignoram a quota individual e continuam sujeitas ao limite geral por IP. As quotas individuais sobrevivem à rotação da chave, pois o identificador estável usado no bucket é o ID do cliente, não o segredo da credencial.

O armazenamento compartilhado é fail-closed: falhas de rede, autenticação ou resposta inválida do Redis passam pelo error handler e bloqueiam a chamada protegida. A rota /health permanece fora dos limitadores para que o orquestrador consiga verificar o processo; ela não representa uma verificação de prontidão do Redis.

## Configuração

Desenvolvimento local:

```dotenv
RATE_LIMIT_STORE=memory
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=120
```

Produção:

```dotenv
NODE_ENV=production
RATE_LIMIT_STORE=upstash
UPSTASH_REDIS_REST_URL=https://your-database.upstash.io
UPSTASH_REDIS_REST_TOKEN=secret-from-upstash
```

Guarde o token REST em um cofre de segredos. Não o comite no repositório, não o envie ao navegador e não use token somente de leitura: o script precisa executar INCR, PEXPIRE e EXPIRE. Em produção, a aplicação exige HTTPS na URL, PostgreSQL e o modo Upstash.

## Histórico de consumo

Cada requisição autenticada por uma credencial individual que alcança o limitador individual incrementa a contagem do dia UTC. Isso inclui respostas 429 do próprio limitador individual. Requisições bloqueadas antes pela quota geral por IP não são atribuídas a um cliente. A credencial master também não gera consumo individual.

Endpoint administrativo:

```http
GET /api/v1/clients/{clientId}/usage?days=30
Authorization: Bearer {API_ACCESS_TOKEN}
```

O parâmetro days aceita inteiros entre 1 e 30. A resposta informa totalRequests e uma lista daily com date (UTC) e requests. O Redis expira as chaves diárias em 35 dias; o modo memory mantém dados apenas enquanto o processo está ativo.

Esse histórico serve para acompanhamento operacional. Não oferece cobrança, medição de custo por operação, limites mensais, nem integridade de auditoria financeira. Para isso, use um ledger persistente dedicado e defina reconciliação e retenção próprias.
