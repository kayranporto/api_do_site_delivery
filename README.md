# Generic Integration API

Base independente para uma API que intermediará operações com serviços externos, usando JavaScript moderno, Node.js, ES Modules e Arquitetura Hexagonal.

## Estado do projeto

As etapas **1 — Domain** e **2 — Application** foram implementadas. Ainda não há servidor Express, rotas HTTP, banco, conectores reais de provedores, autenticação ou deploy.

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
# Suítes Jest e testes nativos do Node.js (após npm install)
npm test

# Testes executáveis sem instalar dependências externas
npm run test:node
```

## Estrutura atual

```text
src/
├── domain/
│   ├── entities/
│   ├── errors/
│   ├── ports/
│   ├── value-objects/
│   └── index.js
└── application/
    ├── errors/
    ├── ports/
    ├── services/
    ├── use-cases/
    └── index.js

tests/
├── jest/
│   ├── application/
│   └── domain/
└── node/
    ├── application.test.js
    └── domain.test.js

docs/
├── application-design.md
└── domain-design.md
```

## Decisões importantes

- O domínio é agnóstico a provedores e protocolos.
- Integrações começam desativadas e precisam ser ativadas explicitamente.
- Segredos são representados apenas por referências opacas; valores secretos não pertencem às entidades.
- Execuções têm estados explícitos, histórico de tentativas e política de backoff.
- A política de retry é copiada para cada execução para preservar previsibilidade.
- Os contratos de repositório são implementados somente por adaptadores futuros.
- Os casos de uso coordenam integrações, execuções, idempotência e retentativas sem acoplamento ao transporte HTTP.

Consulte [`docs/domain-design.md`](docs/domain-design.md) e [`docs/application-design.md`](docs/application-design.md) para o modelo, casos de uso, contratos e fronteiras de segurança.
