# Generic Integration API

Base independente para uma API que intermediará operações com serviços externos, usando JavaScript moderno, Node.js, ES Modules e Arquitetura Hexagonal.

## Estado do projeto

Apenas a **Etapa 1 — Domain** foi implementada. Ainda não há servidor Express, rotas, banco, integrações externas, autenticação ou deploy.

## Requisitos

- Node.js 20 ou superior
- npm

## Instalação

```bash
npm install
```

## Verificação rápida do domínio (sem dependências externas)

```bash
npm run verify:domain
```

## Testes automatizados

```bash
# Suíte Jest (após npm install)
npm test

# Verificação executável sem instalar dependências
npm run test:node
```

## Estrutura atual

```text
src/
└── domain/
    ├── entities/
    ├── errors/
    ├── ports/
    ├── value-objects/
    └── index.js

tests/
├── jest/domain/
│   ├── entities/
│   └── value-objects/
└── node/domain.test.js

docs/
└── domain-design.md
```

## Decisões importantes

- O domínio é agnóstico a provedores e protocolos.
- Integrações começam desativadas e precisam ser ativadas explicitamente.
- Segredos são representados apenas por referências opacas; valores secretos não pertencem às entidades.
- Execuções têm estados explícitos, histórico de tentativas e política de backoff.
- A política de retry é copiada para cada execução para preservar previsibilidade.
- Contratos de repositório não têm implementação nesta etapa.

Consulte [`docs/domain-design.md`](docs/domain-design.md) para o modelo, regras e fronteiras de segurança.
