# Endurecimento operacional

## Rate limiting HTTP e quotas

O middleware aplica limite fixo por IP em /api/v1, antes da autenticação e do parser JSON. O padrão é 120 requisições por janela de 60 segundos. Respostas 429 incluem Retry-After e cabeçalhos X-RateLimit. A configuração pode ser ajustada por RATE_LIMIT_WINDOW_MS e RATE_LIMIT_MAX.

Depois da autenticação, credenciais individuais recebem uma quota separada, definida por rate_limit_max e rate_limit_window_ms no registro da credencial. A credencial master não usa a quota individual, mas continua protegida pelo limite geral por IP.

Em desenvolvimento, RATE_LIMIT_STORE=memory usa memória limitada do processo. Esse modo não coordena réplicas e reinicia os contadores quando o processo reinicia. Em produção, RATE_LIMIT_STORE=upstash é obrigatório; o adaptador usa Redis pela API REST do Upstash e scripts Lua atômicos para compartilhar os contadores entre instâncias. Se o Redis não responder, as requisições /api/v1 falham fechadas com erro de serviço, em vez de ignorar a proteção.

A contagem diária por credencial individual é mantida no Redis com expiração de 35 dias. A rota GET /api/v1/clients/:clientId/usage?days=30, exclusiva da master, apresenta resumo diário até 30 dias. São contagens de requisições recebidas no limitador individual, inclusive as tentativas que excederam a quota; chamadas bloqueadas anteriormente pelo limite geral por IP não entram no resumo. O histórico do modo memory desaparece com o processo e não deve ser usado para auditoria financeira.

O Redis compartilhado não substitui proteção contra DDoS, WAF, controle de egress, limites no gateway ou monitoramento externo. Não habilite trust proxy sem definir explicitamente os proxies confiáveis; caso contrário, o IP pode ser falsificado por cabeçalhos encaminhados.

## CI

O workflow .github/workflows/ci.yml executa npm ci e npm test em push para main e pull requests direcionados a main, usando Node.js 20. A existência do workflow não significa que a execução já passou: confira o status em Actions após o push.

## Retenção dos eventos

A tabela execution_events é append-only pela aplicação. A política de retenção depende de requisitos legais, contratuais e de auditoria da implantação. Antes de habilitar expurgo, defina prazo, aprovação, backup e trilha de auditoria. Não foi criada rotina de exclusão automática nesta etapa.

## Limitações remanescentes

- A telemetria de consumo do Upstash tem retenção de 35 dias e não é um livro contábil nem uma fonte de faturamento.
- A credencial master permanece global e deve ser mantida fora das aplicações consumidoras; chaves individuais têm escopos e allowlists de integração.
- /health é uma verificação de processo, não uma prova de prontidão do banco, do worker ou do Redis.
- Não há alertas, dashboard, métricas Prometheus, SIEM ou política automática de retenção para eventos operacionais.
- A implantação ainda precisa de TLS, firewall/egress, gestão/rotação de segredos, backup PostgreSQL e monitoramento externo.
