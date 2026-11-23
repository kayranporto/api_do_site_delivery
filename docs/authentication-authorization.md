# Etapa 9 — Credenciais e autorização

## Modelo de autenticação

O valor de API_ACCESS_TOKEN continua aceito como credencial master, mantendo compatibilidade com a operação atual. Essa credencial tem acesso integral e deve ficar restrita à administração e à configuração inicial.

Credenciais individuais são criadas pela rota administrativa:

`POST /api/v1/clients`

A resposta contém a chave bruta **uma única vez**. Cada chave começa com `gik_`, contém um prefixo público e um segredo aleatório de 256 bits. O banco armazena somente o hash SHA-256 da chave completa, nunca o valor utilizável. A chave deve ser guardada em um cofre de segredos pelo cliente.

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
- `POST /api/v1/clients/:clientId/revoke`: revoga uma credencial.
- `GET /api/v1/clients/:clientId/audit?limit=100`: lista eventos de criação, autenticação e revogação.
  
A propriedade `lastUsedAt` é atualizada nas autenticações válidas. A auditoria registra request ID e horário, sem armazenar a chave, o IP ou headers sensíveis. A gravação de eventos de autenticação é best-effort: uma falha do repositório de auditoria não bloqueia uma chave válida.

Todas as rotas de gestão de credenciais exigem a chave master. Os metadados nunca retornam `keyHash`.

## Persistência

A migration `004_api_clients` cria `api_clients` e `api_client_audit`. Em instalações PostgreSQL existentes, aplique explicitamente:

`npm run db:migrate`

A API exige a versão `004_api_clients` ao iniciar com PostgreSQL. Nenhum banco remoto foi migrado automaticamente por esta etapa.

O adaptador em memória permite testes e desenvolvimento local, mas perde as credenciais ao reiniciar. Produção exige PostgreSQL.

## Limites ainda existentes

- A chave master permanece com acesso global e não deve ser entregue a aplicações consumidoras.
- Não há expiração automática de chaves, rotação sobreposta nem fluxo de recuperação de segredo.
- Não há quotas individuais por cliente; o rate limiting atual continua por IP e em memória.
- A auditoria não guarda IP nem conteúdo de requisição; a retenção deve ser definida pela implantação.
- A autorização é aplicada no limite HTTP. Chamadas internas aos casos de uso devem ocorrer apenas por componentes confiáveis.
