# Etapa 1 — Domain

## Objetivo do domínio

O projeto representa um **orquestrador genérico de integrações com serviços externos**. Um cliente poderá configurar uma integração, solicitar uma operação pelo nome lógico e acompanhar sua execução. O domínio não conhece Express, HTTP, banco de dados, filas, variáveis de ambiente ou fornecedores concretos.

A abstração suporta diferentes adaptadores de provedores. A camada de aplicação decidirá como despachar uma operação; a infraestrutura implementará a comunicação real.

## Linguagem ubíqua

- **Integração (`Integration`)**: configuração lógica de conexão com um provedor externo.
- **Provedor (`ProviderKey`)**: identificador estável do adaptador que sabe falar com um tipo de serviço externo.
- **Operação (`OperationName`)**: ação lógica solicitada, como `customer.create` ou `invoice.issue`.
- **Execução (`Execution`)**: ciclo de vida de uma solicitação para executar uma operação em uma integração.
- **Chave de idempotência (`IdempotencyKey`)**: identificador enviado pelo chamador para permitir que a camada de aplicação impeça processamento duplicado.
- **Política de repetição (`RetryPolicy`)**: limite e espaçamento de novas tentativas.
- **Referência de configuração/segredo**: identificador opaco para dados mantidos fora do domínio. Nenhum token, senha ou chave é guardado na entidade.

## Entidades e responsabilidades

### Integration

Campos principais: `id`, `name`, `providerKey`, `configurationReference`, `secretReference`, `status`, `timeoutMs`, `retryPolicy`, `createdAt` e `updatedAt`.

Comportamentos: `activate`, `deactivate`, `assertCanExecute`, `rename`, `updateConfigurationReference`, `updateSecretReference`, `updateTimeout` e `updateRetryPolicy`.

Regras: começa inativa; só pode ser ativada explicitamente; timeout deve ficar entre 100 ms e 120 s; timestamps não podem retroceder; segredo e configuração são armazenados como referências, nunca como valores secretos.

### Execution

Campos principais: `id`, `integrationId`, `operationName`, `input`, `idempotencyKey`, `retryPolicy`, `status`, `attempts`, `nextAttemptAt`, `completedAt` e `createdAt`.

Comportamentos: `startAttempt`, `succeed`, `fail`, `cancel` e `interrupt`.

A política de repetição é copiada para a execução no momento de sua criação. Assim, uma alteração posterior na integração não muda silenciosamente o comportamento de uma execução já iniciada.

## Value Objects

| Value Object | Responsabilidade |
|---|---|
| `ProviderKey` | Normaliza e valida o identificador do adaptador. |
| `OperationName` | Valida nomes lógicos de operação, com notação como `resource.action`. |
| `ConfigurationReference` | Identifica configuração externa sem embutir credenciais. |
| `SecretReference` | Identifica um segredo mantido em um cofre externo. |
| `IdempotencyKey` | Valida a chave usada para deduplicação. |
| `RetryPolicy` | Valida máximo de tentativas e calcula backoff exponencial limitado. |

## Estados de Execution

```text
pending -> running -> succeeded
                    -> failed
                    -> retry_scheduled -> running ...
pending ---------------------------> cancelled
retry_scheduled -------------------> cancelled
```

- Uma execução começa em `pending`.
- Só `pending` ou `retry_scheduled` pode iniciar uma tentativa.
- Uma nova tentativa agendada só começa quando `nextAttemptAt` for alcançado.
- `running` pode terminar em `succeeded`, `failed` ou `retry_scheduled`.
- Uma execução em estado final não pode ser retomada.
- `cancelled` só é permitido antes de uma tentativa estar em andamento.
- `interrupted` é um estado final aplicado pelo processo de recuperação a execuções pendentes ou em andamento consideradas abandonadas; uma tentativa em andamento é encerrada com o código `EXECUTION_INTERRUPTED` e não é repetida automaticamente.
- Erros são persistidos como códigos curtos, não mensagens potencialmente sensíveis.

## Serviços de domínio

Nenhum serviço de domínio foi criado nesta etapa. As regras atuais pertencem naturalmente às entidades `Integration` e `Execution` e ao Value Object `RetryPolicy`. Um serviço artificial apenas para encaminhar esses métodos aumentaria o acoplamento sem acrescentar uma regra de negócio. Um serviço será extraído quando surgir uma regra que coordene conceitos de mais de um agregado.

## Ports (contratos de saída)

- `IntegrationRepository`: salvar, localizar por ID, localizar por provedor e listar integrações ativas.
- `ExecutionRepository`: salvar, localizar por ID, localizar por chave de idempotência e localizar execuções cujo retry venceu.

São contratos; nenhuma implementação de banco de dados foi criada nesta etapa.

## Erros do domínio

`DomainError`, `ValidationError`, `BusinessRuleError`, `InvalidStateTransitionError`, `IntegrationInactiveError` e `RetryLimitExceededError`.

## Fronteiras e decisões de segurança

1. Domínio puro em JavaScript ES Modules. Nenhuma dependência de Express, Supabase, SDK de provedor ou ambiente de execução.
2. Segredos nunca são aceitos como campo direto; somente referências opacas. A camada de infraestrutura futura deverá integrar um cofre/gerenciador de segredos.
3. Idempotência depende de persistência com restrição de unicidade na camada de infraestrutura; a entidade apenas valida o formato da chave.
4. `Integration.assertCanExecute()` deve ser aplicado pelo caso de uso antes de despachar uma operação.
5. Retentativas precisam ser combinadas com idempotência para evitar efeitos externos duplicados.
6. Não coloque tokens, senhas ou chaves dentro de `input`; payloads podem conter dados sensíveis e deverão receber validação, minimização e redação de logs nas camadas seguintes.
7. Limites de payload, autenticação/autorização, rate limiting, SSRF, allowlists de destino, assinatura de webhooks, logs e proteção de dados serão tratados nas camadas de aplicação/infraestrutura e na auditoria de segurança correspondente.
8. Não existe acoplamento a HTTP no domínio. Adaptadores futuros podem implementar HTTP, SOAP, RPC ou filas sem alterar estas entidades, desde que exponham operações lógicas compatíveis.

## Fora do escopo desta etapa

- Rotas, controllers, middleware e servidor Express.
- Validação de entrada HTTP com Zod.
- Conectores reais de provedores.
- Persistência, migrations e banco de dados.
- Cofre de segredos, filas, webhooks e autenticação.
- Deploy, CI/CD e configuração de ambiente.
