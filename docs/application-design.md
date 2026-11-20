# Etapa 2 — Application

## Responsabilidade

A camada Application coordena os casos de uso do sistema. Ela recebe comandos, consulta e persiste agregados por meio das portas do domínio e solicita efeitos externos por portas de saída. Não conhece Express, HTTP, Zod, SQL, Supabase, filas ou SDKs específicos.

## Casos de uso implementados

| Caso de uso | Responsabilidade |
|---|---|
| `CreateIntegration` | Cria e persiste uma integração inativa. |
| `ActivateIntegration` | Ativa uma integração existente. |
| `DeactivateIntegration` | Desativa uma integração existente. |
| `GetIntegration` | Busca uma integração por ID. |
| `ListActiveIntegrations` | Lista integrações ativas. |
| `ExecuteOperation` | Valida a integração, aplica idempotência, cria uma execução e delega uma tentativa ao adaptador. |
| `RetryDueExecutions` | Busca execuções com retry vencido e coordena uma nova tentativa. |
| `CancelExecution` | Cancela uma execução ainda cancelável. |

## Portas de saída

- `IntegrationRepository` e `ExecutionRepository` são os contratos definidos na camada Domain.
- `ProviderRegistry.resolve(providerKey)` fornece um adaptador que implementa `execute(command)`.
- `Clock.now()` fornece o relógio do sistema.
- `IdGenerator.generate()` fornece identificadores únicos.

As implementações concretas dessas portas pertencem à etapa Infrastructure. Os testes usam repositórios e adaptadores em memória, sem conexão externa.

## Contrato do adaptador de provedor

O método `execute(command)` recebe `executionId`, integração (ID, chave do provedor, referência de configuração, referência do segredo), `operationName`, `input`, `idempotencyKey` e `timeoutMs`. O adaptador deve lançar `ProviderExecutionError` para falhas conhecidas, informando um código seguro e se a falha é repetível. Erros desconhecidos são tratados como não repetíveis, evitando retries automáticos sem classificação.

As referências de segredo são apenas identificadores opacos. O adaptador/infraestrutura deverá resolver o segredo a partir de um cofre; o domínio e os casos de uso não recebem tokens em texto puro.

## Regras importantes

1. Integrações são criadas inativas; a ativação é explícita.
2. Operações sobre integração inativa são rejeitadas antes de contatar um provedor.
3. A chave de idempotência é verificada antes da execução. Reutilizar a mesma chave com operação/payload diferente gera conflito. A unicidade concorrente deve ser garantida pela persistência (índice/constraint única por integração + chave) na etapa Infrastructure; a consulta isolada não elimina corridas.
4. A execução e a transição para `running` são persistidas antes do efeito externo. O resultado final ou retry agendado é persistido após o adaptador responder.
5. Retentativas são processadas apenas quando `nextAttemptAt` venceu. A execução guarda a política de retry capturada ao ser criada.
6. Uma integração inativa ou inexistente cancela uma execução agendada, evitando tentativas contra uma configuração indisponível.
7. `ProviderExecutionError.retryable` deve ser definido pelo adaptador com classificação conservadora. Erro desconhecido não é repetido automaticamente.
8. Falhas são armazenadas como códigos estáveis; mensagens e detalhes internos do provedor não são propagados para o agregado.

## Consistência operacional e limitações conhecidas

A persistência da execução antes e depois da chamada externa reduz perda de estado, mas não cria uma transação distribuída. Se o provedor concluir a operação e a gravação final falhar, a execução pode permanecer `running`. Idempotência ponta a ponta requer que o provedor aceite a chave e que a infraestrutura implemente reconciliação/timeout de execuções abandonadas. Não foi implementado worker, lock, lease, outbox, scheduler ou mecanismo de reconciliação nesta etapa.

O `result` devolvido pelo adaptador é retornado pelo caso de uso, mas não é persistido no agregado Domain atual. Persistir respostas exige definir um contrato explícito de armazenamento e política de retenção/mascaramento na próxima revisão do domínio/infraestrutura.

## Fora do escopo desta etapa

- Controllers, rotas HTTP, middleware e servidor Express.
- Validação HTTP com Zod.
- Banco, migrations e repositórios concretos.
- Adaptadores de provedores reais e gestão concreta de segredos.
- Filas, workers, scheduler, outbox, locks ou reconciliação.
- Autenticação, autorização, rate limiting e deploy.
