# Etapa 12 — Monitoramento, métricas e alertas

## Readiness e liveness

- `GET /health` verifica somente se o processo HTTP responde (liveness).
- `GET /readyz` executa verificações das dependências configuradas. Quando PostgreSQL é utilizado, faz `SELECT 1`; quando Redis/Upstash é utilizado, faz `PING`. A resposta é 200 com `status: ready` ou 503 com `status: not_ready`. Apenas nomes de dependências e estados `ok/unavailable` são expostos; exceções e strings de conexão não são devolvidas.

## Métricas HTTP

`GET /api/v1/observability/performance?windowMinutes=5` retorna:

- Total de solicitações concluídas na janela.
- Contagens 4xx, 5xx e 429, e suas taxas 5xx/429.
- Latência média, p50, p95 e máxima em milissegundos.
- Distribuição por status e até 20 combinações método/rota.
- Uptime, estimativa de CPU, RSS, heap, memória externa e array buffers do processo.

A janela aceita de 1 a 60 minutos. A coleta usa um buffer de no máximo 10.000 amostras por processo. As métricas são locais à instância, não agregadas entre réplicas, e desaparecem quando o processo reinicia. Uma amostra é registrada quando a resposta HTTP termina.

Privacidade e cardinalidade: são utilizados templates de rota do Express; requisições sem rota conhecida são agrupadas em `_unmatched`. O coletor não guarda IP, identificadores de requisição, parâmetros concretos, query string, corpo, headers, segredos nem credenciais. O número de rotas retornadas é limitado a 20.

## Alertas avaliados por regras

`GET /api/v1/observability/alerts?windowMinutes=5` avalia quatro regras:

| Código | Condição | Severidade |
|---|---|---|
| `HTTP_P95_LATENCY_HIGH` | p95 igual ou acima de ALERT_P95_LATENCY_MS, com pelo menos ALERT_MIN_REQUESTS | warning |
| `HTTP_5XX_RATE_HIGH` | taxa 5xx igual ou acima de ALERT_ERROR_RATE_PERCENT, com amostra mínima | critical |
| `HTTP_429_RATE_HIGH` | taxa 429 igual ou acima de ALERT_429_RATE_PERCENT, com amostra mínima | warning |
| `PROCESS_RSS_HIGH` | RSS igual ou acima de ALERT_RSS_MB | warning |

A rota retorna `status: ok` ou `status: firing`, a instância, janela, limites e alertas observados. As condições de taxa/latência exigem amostra mínima para reduzir ruído em baixo tráfego. O RSS é avaliado independentemente do volume.

## Configuração

Os valores padrão estão em `.env.example`:

```dotenv
OBSERVABILITY_WINDOW_MINUTES=5
ALERT_MIN_REQUESTS=20
ALERT_P95_LATENCY_MS=1000
ALERT_ERROR_RATE_PERCENT=5
ALERT_429_RATE_PERCENT=20
ALERT_RSS_MB=512
```

Ambos os endpoints de observabilidade exigem credencial com escopo global `observability:read`. Uma credencial individual com lista de integrações limitada não consegue consultar métricas agregadas de toda a API.

## Limitações

- Alertas são calculados quando a rota é consultada; não existe agendador, histórico persistido de incidentes ou envio por e-mail, Slack, SMS ou webhook.
- Métricas HTTP são por processo. Em várias réplicas, cada instância mostra apenas sua própria amostra.
- O buffer é volátil e não substitui telemetria histórica nem auditoria contábil.
- Para alertas proativos e visibilidade multi-instância, conecte exportação Prometheus/OpenTelemetry e um serviço externo de alertas.
