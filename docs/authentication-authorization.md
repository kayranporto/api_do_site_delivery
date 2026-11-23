# Etapa 9 — Credenciais e autorização

## Modelo de autenticação

O valor de API_ACCESS_TOKEN continua aceito como credencial master, mantendo compatibilidade com a operação atual. Essa credencial tem acesso integral e deve ficar restrita à administração e à configuração inicial.

Credenciais individuais são criadas pela rota administrativa:

`POST /api/v1/clients`

A resposta contém a chave bruta **uma única vez por emissão**. Cada chave começa com `gik_`, contém um prefixo público e um segredo aleatório de 256 bits. O banco armazena somente o hash SHA-256 da chave completa, nunca o valor utilizável. A chave deve ser guardada em um cofre de segredos pelo cliente. Novas chaves expiram em 90 dias por padrão; a criação e a rotação aceitam `expiresInDays` entre 1 e 3650.

A autenticação consulta o prefixo e compara o hash em tempo constante. Credenciais revogadas deixam de autenticar imediatamente; não há cache local de permissões.

## Escopos

Os escopos permitidos são:

- `integrations:read`: listar e consultar integrações autorizadas.
- `integrations:manage`: ativar e desativar integrações autorizadas.
- `executions:read`: consultar execuções e seus eventos.
- `executions:write`: iniciar e cancelar operações.
- `executions:reconcile`: consultar a reconciliação de execuções interrompidas.
- `observability:read`: consultar métricas agregadas; exige `integrationIds: null`, pois as métricas não são segmentadas por integração.

A criação de integrações e a administração de credenciais permanecem exclusivas da credencial master. Um cliente recebe apenas os escopos explicitamente concedidos. Ausência de escopo retorna 403.

## Restrição por integração

O campo `integrationIds` restringe a credencial a identificadores específicos:

- Campo omitido ou lista vazia: nenhuma integração é autorizada.
- Lista com IDs: somente os IDs da lista são acessíveis.
- `null`: acesso a todas as integrações, para clientes de confiança elevada.

As consultas por execução verificam também o `integrationId` da execução. Recursos fora do escopo retornam 404 para não revelar sua existência.

## Gestão e auditoria

- `GET /api/v1/clients`: lista metadados sem segredos nem hashes.
- `POST /api/v1/clients/:clientId/rotate`: troca prefixo e segredo, renova a validade e invalida a chave anterior imediatamente; a resposta exibe a nova chave uma única vez.
- `POST /api/v1/clients/:clientId/limits`: atualiza `rateLimitMax` e/ou `rateLimitWindowMs` sem trocar a chave.
- `POST /api/v1/clients/:clientId/revoke`: revoga uma credencial.
- `GET /api/v1/clients/:clientId/audit?limit=100`: lista eventos de criação, autenticação, rotação, atualização de limites e revogação.
  
A propriedade `lastUsedAt` é atualizada nas autenticações válidas. A auditoria de autenticação ocorre somente depois que a quota individual foi aprovada. A auditoria registra request ID e horário, sem armazenar a chave, o IP ou headers sensíveis. A gravação de eventos de autenticação é best-effort: uma falha do repositório de auditoria não bloqueia uma chave válida.

Todas as rotas de gestão de credenciais exigem a chave master. Os metadados nunca retornam `keyHash`.

## Persistência

A migration `004_api_clients` cria `api_clients` e `api_client_audit`. A migration `005_api_client_lifecycle` adiciona validade e configuração de quotas por cliente. Credenciais preexistentes recebem validade de 90 dias contados do `created_at`; chaves que já ultrapassaram esse prazo ficam expiradas assim que a migration for aplicada. A coluna `expires_at` passa a ser obrigatória. Em instalações PostgreSQL existentes, aplique explicitamente:

`npm run db:migrate`

A API exige a versão `005_api_client_lifecycle` ao iniciar com PostgreSQL. Nenhum banco remoto foi migrado automaticamente por esta etapa.

O adaptador em memória permite testes e desenvolvimento local, mas perde as credenciais ao reiniciar. Produção exige PostgreSQL.

## Limites ainda existentes

- A chave master permanece com acesso global e não deve ser entregue a aplicações consumidoras.
- A rotação invalida imediatamente a chave antiga; não há período de sobreposição nem fluxo de recuperação do segredo.
- Quotas por cliente são contadas em memória por instância e complementam o limite geral por IP. Em múltiplas réplicas, limites não são compartilhados nem consistentes entre instâncias.
- A auditoria não guarda IP nem conteúdo de requisição; a retenção deve ser definida pela implantação.
- A autorização é aplicada no limite HTTP. Chamadas internas aos casos de uso devem ocorrer apenas por componentes confiáveis.


## Expiração e quotas (Etapa 10)

Novas credenciais recebem validade de 90 dias por padrão. O campo `expiresInDays` aceita de 1 a 3650 dias. Credenciais expiradas deixam de autenticar automaticamente; a consulta por prefixo verifica `expires_at` no PostgreSQL e o horário atual no adaptador em memória.

No corpo de criação, `rateLimitMax` define a quantidade de requisições permitidas e `rateLimitWindowMs` define a janela fixa em milissegundos. Os padrões são 120 requisições por 60000 ms. Limites aceitos: 1–100000 requisições e 1000–3600000 ms por janela.

O limitador por cliente usa o ID estável do cliente, não o prefixo da chave. Portanto, rotacionar a chave não reinicia a quota. A camada global por IP permanece ativa antes da autenticação. Ambos os limitadores são em memória/local à instância; em ambientes horizontais, configure controles equivalentes e compartilhados no gateway/WAF ou em uma camada de rate limiting distribuída.
