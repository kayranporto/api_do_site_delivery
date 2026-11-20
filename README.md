# Generic Integration API

Base independente para uma API que intermediará operações com serviços externos, usando JavaScript moderno, Node.js, ES Modules e Arquitetura Hexagonal.

## Estado do projeto

As etapas **1 — Domain**, **2 — Application** e **3 — Infrastructure** foram implementadas. Ainda não há servidor Express, rotas HTTP, banco de produção, autenticação ou deploy.

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
├── domain/
│   ├── entities/
│   ├── errors/
│   ├── ports/
│   ├── value-objects/
│   └── index.js
├── application/
│   ├── errors/
│   ├── ports/
│   ├── services/
│   ├── use-cases/
│   └── index.js
└── infrastructure/
    ├── configuration/
    ├── providers/
    ├── repositories/
    ├── secrets/
    ├── system/
    └── index.js

tests/
├── jest/
│   ├── application/
│   └── domain/
└── node/
    ├── application.test.js
    ├── domain.test.js
    ├── application.test.js
    └── infrastructure.test.js

docs/
├── application-design.md
├── domain-design.md
└── infrastructure-design.md
```

## Decisões importantes

- O domínio é agnóstico a provedores e protocolos.
- Integrações começam desativadas e precisam ser ativadas explicitamente.
- Segredos são representados apenas por referências opacas; valores secretos não pertencem às entidades.
- Execuções têm estados explícitos, histórico de tentativas e política de backoff.
- A política de retry é copiada para cada execução para preservar previsibilidade.
- Os contratos de repositório são implementados somente por adaptadores futuros.
- Os casos de uso coordenam integrações, execuções, idempotência e retentativas sem acoplamento ao transporte HTTP.
- Os adaptadores de infraestrutura concretos incluem memória (somente desenvolvimento/testes), registro de provedores, REST genérico, relógio, UUID, configuração e resolução de segredos via ambiente.

Consulte [`docs/domain-design.md`](docs/domain-design.md), [`docs/application-design.md`](docs/application-design.md) e [`docs/infrastructure-design.md`](docs/infrastructure-design.md) para o modelo, casos de uso, adaptadores e fronteiras de segurança.
