# Etapa 4 — Interface HTTP

## Inicialização

1. Instale Node.js 20 ou superior e execute `npm install`.
2. Copie `.env.example` para `.env`.
3. Defina `API_ACCESS_TOKEN` com um valor aleatório de pelo menos 32 caracteres.
4. Configure `CORS_ORIGINS` com origens exatas, separadas por vírgula.
5. Execute `npm start`. O servidor escuta em `127.0.0.1:3000` por padrão.

## Autenticação e controles

- `GET /health` é público e serve apenas para liveness.
- Todas as rotas `/api/v1/*` exigem `Authorization: Bearer <API_ACCESS_TOKEN>`.
- O token é comparado em tempo constante quando os comprimentos coincidem.
- Helmet define cabeçalhos de segurança; CORS usa allowlist exata, sem wildcard.
- O middleware de autenticação é executado antes do parser JSON.
- O parser aceita JSON estrito até 64 KiB.
- Cada resposta contém `X-Request-Id`.
- Schemas Zod rejeitam propriedades desconhecidas.
- Respostas não expõem referências internas de configuração/segredo, payload da execução nem chave de idempotência.

## Rotas

| Método | Caminho | Finalidade |
|---|---|---|
| GET | `/health` | Liveness público |
| POST | `/api/v1/integrations` | Criar integração inativa |
| GET | `/api/v1/integrations` | Listar integrações ativas |
| GET | `/api/v1/integrations/:integrationId` | Consultar integração |
| POST | `/api/v1/integrations/:integrationId/activate` | Ativar integração |
| POST | `/api/v1/integrations/:integrationId/deactivate` | Desativar integração |
| POST | `/api/v1/integrations/:integrationId/operations` | Executar operação |
| GET | `/api/v1/executions/:executionId` | Consultar execução |
| POST | `/api/v1/executions/:executionId/cancel` | Cancelar execução |

## Criar integração

O campo `secretReference`, quando fornecido, só aceita referência `env:NOME_DA_VARIAVEL`; o corpo HTTP nunca recebe o segredo em texto puro.

```json
{
  "name": "Example CRM",
  "providerKey": "example-provider",
  "configurationReference": "config:example:default",
  "secretReference": "env:EXAMPLE_PROVIDER_TOKEN",
  "timeoutMs": 5000
}
```

Integrações são criadas inativas; chame a rota de ativação explicitamente.

## Executar operação

Envie a chave de idempotência preferencialmente no header `Idempotency-Key`.

```http
POST /api/v1/integrations/:integrationId/operations
Authorization: Bearer <API_ACCESS_TOKEN>
Content-Type: application/json
Idempotency-Key: operation-2026-000001
```

```json
{
  "operationName": "records.create",
  "payload": { "name": "Example" }
}
```

## Configuração de provedor

`PROVIDER_CONFIG_JSON` é um objeto cujas chaves são referências de configuração. Cada entrada define `providerKey`, `baseUrl`, `allowedHosts` e operações explicitamente mapeadas. Para encaminhar uma chave de idempotência ao serviço externo via REST, defina opcionalmente `idempotencyHeaderName` (por exemplo, `Idempotency-Key`); o adaptador não envia a chave a provedores que não tenham essa opção configurada. Não coloque credenciais nele; configure a referência `env:...` e mantenha o segredo na variável de ambiente correspondente.

## Limitações antes de produção

- Repositórios atuais são em memória e perdem dados ao reiniciar.
- Não há autenticação de usuários, papéis, escopos ou autorização por integração.
- O token Bearer compartilhado não substitui controle de acesso por recurso.
- Não há rate limiting, worker/scheduler, lock distribuído, outbox ou reconciliação de execuções abandonadas.
- O adaptador HTTP restringe hosts, mas uma implantação de produção ainda precisa de políticas de egress, firewall e proteção DNS/IP no ambiente.
- Provedores reais só devem ser configurados depois de revisão das permissões e dos requisitos operacionais.
