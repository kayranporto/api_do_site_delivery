# Generic Integration API

API independente para orquestrar operações com serviços externos, usando Node.js, JavaScript ES Modules e Arquitetura Hexagonal.

## Estado

Etapas 1 (Domain), 2 (Application), 3 (Infrastructure) e 4 (Interface HTTP) implementadas. A aplicação ainda é **um esqueleto de desenvolvimento**, não está pronta para produção: os repositórios usados na composição atual são em memória e perdem os dados ao reiniciar.

## Instalação e execução

Requer Node.js 20+.

```bash
npm install
cp .env.example .env
# Gere um API_ACCESS_TOKEN aleatório com pelo menos 32 caracteres
npm start
```

Servidor local por padrão: `http://127.0.0.1:3000`.

## Configuração

- `API_ACCESS_TOKEN`: token Bearer de serviço (mínimo 32 caracteres).
- `HOST`: por padrão `127.0.0.1`.
- `PORT`: por padrão `3000`.
- `CORS_ORIGINS`: origens exatas separadas por vírgula; sem wildcard.
- `PROVIDER_CONFIG_JSON`: objeto JSON com configurações dos provedores.
- Segredos são referenciados como `env:NOME_DA_VARIAVEL`; não grave valores secretos no Git.

## Testes

```bash
npm test
npm run test:node
```

## Estrutura

- `src/domain`: entidades, Value Objects, erros e portas.
- `src/application`: casos de uso e contratos de saída.
- `src/infrastructure`: repositórios em memória, provedores e adaptadores HTTP.
- `src/bootstrap`: composição de dependências.
- `src/server.js`: inicialização do servidor Express.
- `tests`: testes Node.js e Jest.
- `docs`: decisões das camadas e contrato HTTP.

Consulte [docs/http-api.md](docs/http-api.md) para rotas e exemplos e os outros documentos em `docs/` para os limites das camadas.
