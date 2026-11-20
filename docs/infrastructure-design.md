# Etapa 3 — Infrastructure

## Objetivo

Implementar adaptadores concretos para portas da aplicação/domínio, sem obrigar o projeto a escolher um banco de dados antes de definir os requisitos de implantação e operação.

## Adaptadores entregues

- `InMemoryIntegrationRepository` e `InMemoryExecutionRepository`: adaptadores voláteis para testes e desenvolvimento local. Serializam e reconstituem agregados, indexam chaves de idempotência no processo e consultam retries vencidos. **Não são persistência de produção**; dados se perdem ao reiniciar e a unicidade não coordena processos distintos.
- `MapProviderRegistry`: registro explícito de adaptadores pelo ProviderKey.
- `MapConfigurationResolver`: resolve referências de configuração fornecidas pelo composition root e entrega cópias defensivas.
- `EnvironmentSecretResolver`: resolve referências no formato `env:VARIABLE_NAME`. Adequado apenas para desenvolvimento simples; produção deve integrar secret manager gerenciado.
- `SystemClock` e `UuidGenerator`: relógio e geração de UUID usando APIs nativas do Node.js.
- `HttpRestProviderAdapter`: adaptador REST genérico para operações previamente declaradas em configuração confiável.

## Configuração de um provedor REST

Exemplo estrutural (não contém credenciais):

```js
{
  baseUrl: 'https://api.vendor.example',
  allowedHosts: ['api.vendor.example'],
  authentication: { type: 'bearer' },
  operations: {
    'records.create': { method: 'POST', path: '/v1/records' },
    'records.get': { method: 'GET', path: '/v1/records' }
  }
}
```

O `baseUrl` precisa ser HTTPS e seu hostname deve constar em `allowedHosts`. Caminhos de operações são relativos à origem; redirects HTTP são bloqueados. Hosts locais, caminhos de rede externos, métodos não suportados e headers perigosos são rejeitados. Requisições e respostas têm limites de tamanho. Timeout usa `AbortSignal.timeout`.

A autenticação suporta bearer token ou header estático, mas o segredo é resolvido somente na hora da chamada a partir da `SecretReference`; não é colocado no domínio, nos logs ou em mensagens de erro.

## Limites de segurança

1. `allowedHosts` é política de configuração confiável, não dado recebido do chamador. Não permita que payloads ou usuários escolham `baseUrl`, hostname, método ou path diretamente.
2. O bloqueio de hosts locais e redirects reduz SSRF, mas a validação em aplicação não substitui egress firewall, DNS/IP allowlisting ou políticas de rede. DNS rebinding e mudanças de resolução precisam ser mitigados na plataforma de execução.
3. `EnvironmentSecretResolver` é apenas um adaptador de conveniência. Use secret manager com controle de acesso, rotação e auditoria em produção.
4. Repositórios em memória não oferecem persistência durável nem locking distribuído.
5. A unicidade de idempotência precisa de constraint atômica no banco escolhido. A verificação read-before-call da Application não elimina corrida distribuída.
6. Não há banco, filas, worker, outbox, locks, circuit breaker, observabilidade nem reconciliação de execuções abandonadas nesta etapa.

## Escolhas adiadas

- Banco de dados e estratégia de migrations.
- Secret manager de produção.
- Fila/worker e estratégia de agendamento.
- Política de egress, DNS e allowlists dos fornecedores.
- Persistência de resultados de provedor e política de retenção.

Essas decisões devem preceder a implantação real. A próxima camada pode construir o composition root e a interface HTTP usando estes adaptadores sem misturar regras de negócio com transporte.
