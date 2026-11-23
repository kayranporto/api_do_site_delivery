# Etapa 4 — Interface HTTP

## Inicialização

1. Instale Node.js 20 ou superior e execute `npm ci`.
2. Copie `.env.example` para `.env`.
3. Defina `API_ACCESS_TOKEN` com um valor aleatório de pelo menos 32 caracteres.
4. Configure `CORS_ORIGINS` com origens exatas, separadas por vírgula.
5. Execute `npm start`. O servidor escuta em `127.0.0.1:3000` por padrão.

## Autenticação e controles

- `GET /health` é público e serve apenas para liveness.
- Todas as rotas `/api/v1/*` exigem uma credencial Bearer.
- `API_ACCESS_TOKEN` continua sendo a credencial master, com acesso global e uso exclusivo administrativo.
- Credenciais individuais `gik_...` são verificadas por hash SHA-256 em tempo constante e carregam escopos e IDs de integração permitidos.
- Chaves individuais são exibidas somente na criação; o banco guarda apenas o hash. Revogação passa a valer nas requisições seguintes.
- Consulte `authentication-authorization.md` para os escopos, rotas administrativas e política de isolamento.
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
| GET | `/api/v1/executions/:executionId/events` | Consultar eventos de uma execução |
| POST | `/api/v1/executions/:executionId/reconcile` | Consultar resultado externo de uma execução interrompida |
| GET | `/api/v1/observability/metrics` | Consultar contagens agregadas de execuções e eventos |

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

`PROVIDER_CONFIG_JSON` é um objeto cujas chaves são referências de configuração. Cada entrada define `providerKey`, `baseUrl`, `allowedHosts` e operações explicitamente mapeadas. Para encaminhar uma chave de idempotência ao serviço externo via REST, defina opcionalmente `idempotencyHeaderName` (por exemplo, `Idempotency-Key`); o adaptador não envia a chave a provedores que não tenham essa opção configurada. Para habilitar reconciliação, cada operação pode declarar um bloco `reconciliation` com método somente GET/HEAD, caminho, campo de status e mapeamento de status. O endpoint é consultado somente quando a rota autenticada de reconciliação é chamada. Não coloque credenciais nele; configure a referência `env:...` e mantenha o segredo na variável de ambiente correspondente.

## Reconciliação e observabilidade

Uma operação pode declarar no provedor REST um endpoint de consulta somente leitura. Exemplo de estrutura dentro de uma definição de operação:

```json
{
  "method": "POST",
  "path": "/v1/records",
  "reconciliation": {
    "method": "GET",
    "path": "/v1/operations/{idempotencyKey}",
    "statusField": "data.state",
    "notFoundStatusCodes": [404],
    "statusMap": {
      "succeeded": ["completed", "done"],
      "failed": ["rejected", "error"],
      "pending": ["queued", "processing"],
      "not_found": ["missing"]
    }
  }
}
```

Placeholders aceitos: {executionId}, {idempotencyKey} e {operationName}. O caminho é limitado ao hostname já aprovado em allowedHosts. A resposta normalizada é succeeded, failed, pending, not_found ou unknown. Resposta desconhecida não altera a execução: ela continua interrupted.

- POST /api/v1/executions/:executionId/reconcile: consulta uma execução interrompida, se o provedor oferecer suporte.
- GET /api/v1/executions/:executionId/events?limit=100: lista a trilha operacional.
- GET /api/v1/observability/metrics?windowHours=24: devolve contagens de estados e eventos agregados.

Todos esses endpoints exigem o mesmo Bearer token de serviço. Os eventos guardam apenas uma lista permitida de atributos operacionais; payload, segredos, headers e mensagens livres do provedor são omitidos.

## Limitações antes de produção

- Repositórios atuais são em memória e perdem dados ao reiniciar.
- A credencial master continua tendo acesso global; aplicações consumidoras devem usar chaves individuais restritas.
- O rate limiting continua local por IP e não é distribuído entre réplicas.
- Ainda faltam expiração e rotação automática de chaves, alertas, painel de operação e política automática de retenção dos eventos.
- O adaptador HTTP restringe hosts, mas uma implantação de produção ainda precisa de políticas de egress, firewall e proteção DNS/IP no ambiente.
- Provedores reais só devem ser configurados depois de revisão das permissões e dos requisitos operacionais.


## Credenciais individuais (Etapa 9)

| Método | Caminho | Permissão |
|---|---|---|
| POST | `/api/v1/clients` | Master: criar credencial individual |
| GET | `/api/v1/clients` | Master: listar metadados das credenciais |
| POST | `/api/v1/clients/:clientId/revoke` | Master: revogar credencial |
| GET | `/api/v1/clients/:clientId/audit` | Master: consultar auditoria |

A credencial individual precisa ter o escopo adequado para cada rota. O campo `integrationIds` limita as integrações e as execuções acessíveis; a ausência do campo ou uma lista vazia significa nenhum acesso, enquanto `null` significa acesso global. A criação de integrações e a administração de credenciais exigem a credencial master.
