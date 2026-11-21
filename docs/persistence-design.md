# Etapa 5 — Persistência e execução confiável

## Adaptador PostgreSQL

A infraestrutura oferece os repositórios **PostgresIntegrationRepository** e **PostgresExecutionRepository**. Eles implementam as portas do domínio e recebem um Pool compatível com node-postgres. O domínio e os casos de uso não dependem do driver.

A URL de conexão é lida de **DATABASE_URL**; **DATABASE_POOL_MAX** define o limite do pool (1–50, padrão 10). Em desenvolvimento, a ausência de DATABASE_URL mantém os adaptadores em memória. Em NODE_ENV=production, DATABASE_URL é obrigatório.

## Migration explícita

Configurar DATABASE_URL não altera o banco. A migration inicial é aplicada somente por comando explícito:

- Instale as dependências com **npm install**.
- Copie o arquivo de ambiente: **cp .env.example .env**.
- Configure DATABASE_URL e API_ACCESS_TOKEN no arquivo .env.
- Aplique o schema com **npm run db:migrate**.
- Inicie a API com **npm start**.

O migrador usa transação e advisory lock do PostgreSQL para evitar duas aplicações simultâneas da mesma versão. O servidor apenas verifica se o schema esperado existe; ele não aplica DDL durante o startup.

## Idempotência

A tabela executions tem índice único parcial em (integration_id, idempotency_key), ignorando chaves nulas. O caso de uso reserva o registro em estado pending antes de chamar o provedor. No PostgreSQL, essa reserva é uma inserção atômica com ON CONFLICT DO NOTHING; requisições concorrentes com a mesma chave recuperam a execução já criada.

A mesma chave com operação ou payload diferente resulta em conflito HTTP 409. O escopo da chave é uma integração; a mesma chave pode ser usada em integrações distintas.

## Reivindicação de retries

O repositório reivindica retries vencidos em uma única instrução com FOR UPDATE SKIP LOCKED e um lease configurável. O lease é mantido durante a chamada externa e renovado em segundo plano. Um fencing token vinculado ao objeto de execução impede que um worker com lease substituído grave um estado obsoleto.

O lease evita que workers saudáveis executem simultaneamente a mesma tentativa. Ele não transforma chamadas HTTP externas em operações exactly-once: uma falha de processo depois de o provedor aceitar a requisição, mas antes de a aplicação persistir o sucesso, pode exigir repetição. Para evitar efeitos duplicados, o provedor externo também precisa respeitar a chave de idempotência recebida.

## Etapa 6 — Worker

O processo separado `npm run worker` executa a recuperação de execuções abandonadas e os retries vencidos. `npm run worker:once` executa um único ciclo. Os detalhes de agendamento, leases, fencing e desligamento estão em [worker-design.md](worker-design.md).

A migration `002_execution_interrupted` inclui o estado final `interrupted` e o índice de recuperação. A migration `003_operational_events` cria o armazenamento append-only de eventos operacionais. O migrador aplica versões pendentes em ordem, sob transação e advisory lock.

## Etapa 7 — Eventos e métricas

A tabela execution_events registra eventos de tentativa, interrupção e reconciliação. O repositório valida eventType/severity e persiste somente campos whitelisted em details. O payload da operação, segredos, headers e mensagens de erro livres não são incluídos. A API agrega contagens por estado, tipo e severidade; não há retenção/expurgo automático nesta etapa.

## Limites atuais

- O worker é um processo separado e precisa ser iniciado/supervisionado pela plataforma de hospedagem.
- A reconciliação de execuções interrupted é disparada manualmente; não existe polling automático de endpoints do provedor.
- A aplicação não cria banco, usuário, rede, segredo ou infraestrutura gerenciada.
- O adaptador em memória é volátil e serve somente para testes/desenvolvimento.
- Não foi configurado nem migrado nenhum banco remoto nesta etapa.
