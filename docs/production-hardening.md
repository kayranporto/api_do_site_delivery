# Etapa 8 — Endurecimento operacional

## Rate limiting HTTP

A API aplica limite fixo por IP nas rotas /api/v1, antes da autenticação e do parser JSON. Os padrões são 120 requisições por janela de 60 segundos. Respostas 429 incluem Retry-After e cabeçalhos X-RateLimit. A configuração pode ser ajustada por RATE_LIMIT_WINDOW_MS e RATE_LIMIT_MAX.

O limitador é local ao processo e usa memória limitada. Ele não coordena múltiplas réplicas, não substitui proteção contra DDoS e não deve ser tratado como quota por cliente autenticado. Em produção horizontal, configure também limites no API gateway/WAF ou um armazenamento compartilhado como Redis. Não habilite trust proxy sem definir explicitamente os proxies confiáveis; caso contrário, o IP pode ser falsificado por cabeçalhos encaminhados.

## CI

O workflow .github/workflows/ci.yml executa npm ci e npm test em push para main e pull requests direcionados a main, usando Node.js 20. A existência do workflow não significa que a execução já passou: confira o status em Actions após o push.

## Retenção dos eventos

A tabela execution_events é append-only pela aplicação. A política de retenção depende de requisitos legais, contratuais e de auditoria da implantação. Antes de habilitar expurgo, defina prazo, aprovação, backup e trilha de auditoria. Não foi criada rotina de exclusão automática nesta etapa.

## Limitações remanescentes

- Rate limiting em memória não é distribuído.
- Autenticação continua sendo um único Bearer token de serviço; não há credenciais individuais, scopes ou autorização por integração.
- /health é uma verificação de processo, não uma prova de prontidão do banco ou do worker.
- Não há alertas, dashboard, métricas Prometheus, SIEM ou política automática de retenção.
- A implantação ainda precisa de TLS, firewall/egress, gestão/rotação de segredos, backup e monitoramento externo.
