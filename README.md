# Generic Integration API

API independente para orquestrar operações com serviços externos, usando Node.js, JavaScript ES Modules e Arquitetura Hexagonal.

## Estado

Etapas 1 (Domain), 2 (Application), 3 (Infrastructure), 4 (Interface HTTP) e 5 (Persistência PostgreSQL) implementadas. O projeto ainda **não está pronto para produção**: falta o worker/scheduler automático e a reconciliação de execuções interrompidas; também são necessários controles operacionais específicos do ambiente.

## Instalação e execução

Requer Node.js 20 ou superior. Execute **npm install**, copie **.env.example** para **.env**, configure um API_ACCESS_TOKEN aleatório com pelo menos 32 caracteres e inicie com **npm start**.

Sem DATABASE_URL, o modo local usa repositórios em memória e perde os dados ao reiniciar.

## PostgreSQL

Configure DATABASE_URL e DATABASE_POOL_MAX no arquivo .env. Antes de iniciar a API pela primeira vez, aplique a migration de forma explícita com **npm run db:migrate**. Depois, inicie com **npm start**.

O servidor verifica a versão do schema, mas não aplica migrations automaticamente. Em NODE_ENV=production, DATABASE_URL é obrigatório.

## Configuração

- **API_ACCESS_TOKEN**: token Bearer de serviço (mínimo 32 caracteres).
- **HOST**: por padrão 127.0.0.1.
- **PORT**: por padrão 3000.
- **NODE_ENV**: development por padrão; production exige PostgreSQL.
- **CORS_ORIGINS**: origens exatas separadas por vírgula; sem wildcard.
- **PROVIDER_CONFIG_JSON**: objeto JSON com configurações dos provedores.
- **DATABASE_URL**: URL PostgreSQL opcional em desenvolvimento, obrigatória em produção.
- **DATABASE_POOL_MAX**: limite de conexões (1–50, padrão 10).
- Segredos de provedores são referenciados como env:NOME_DA_VARIAVEL; não grave valores secretos no Git.

## Testes

Execute **npm test** para Jest e testes Node.js. A suíte Node pode ser executada separadamente com **npm run test:node**.

## Estrutura

- src/domain: entidades, Value Objects, erros e portas.
- src/application: casos de uso e contratos de saída.
- src/infrastructure: repositórios em memória e PostgreSQL, provedores e adaptadores HTTP.
- database/migrations: schema versionado do PostgreSQL.
- src/bootstrap: composição de dependências.
- src/server.js: inicialização do servidor Express.
- tests: testes Node.js e Jest.
- docs: decisões das camadas, contrato HTTP e persistência.

Consulte docs/http-api.md e docs/persistence-design.md para rotas, exemplos e limites operacionais.
