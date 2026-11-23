# Etapa 12/13 — Monitoramento, métricas e alertas centralizados

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

## Exportação Prometheus — Etapa 13

A rota `GET /metrics` oferece Prometheus exposition format 0.0.4, com gauges da janela móvel HTTP e métricas do processo. O scraping usa uma credencial independente da master:

```http
GET /metrics
Authorization: Bearer {METRICS_ACCESS_TOKEN}
```

Em desenvolvimento, a rota fica desabilitada (404) enquanto o token não estiver definido. Em produção, `METRICS_ACCESS_TOKEN` com pelo menos 32 caracteres é obrigatório. Configure o Prometheus para fazer scrape de cada instância e armazene o token como segredo do job. Os dados incluem contagens na janela, status, latência média/p50/p95/máxima, rotas Express limitadas a templates e uso de memória/CPU.

## Notificações automáticas por webhook

Quando `ALERT_WEBHOOK_URL` é configurada, o servidor inicia um monitor periódico que avalia as mesmas regras de alerta. A URL precisa usar HTTPS em qualquer ambiente. `ALERT_WEBHOOK_TOKEN` é opcional e vai somente no header Authorization.

O corpo enviado contém `event`, `status` (`firing` ou `resolved`), `generatedAt`, `instanceId`, `windowMinutes`, alertas com código/severidade/valor/limite e códigos recuperados. Não inclui dados de requisição nem credenciais. O monitor envia notificações quando um código entra em firing, lembretes após `ALERT_NOTIFICATION_COOLDOWN_MS` e eventos de resolução quando deixa de disparar. O envio é repetido no ciclo seguinte se falhar; redirects são recusados e existe timeout.

Exemplo de configuração:

```dotenv
METRICS_ACCESS_TOKEN=use-a-separate-random-secret-at-least-32-characters
ALERT_WEBHOOK_URL=https://alerts.example.com/api/webhooks/your-endpoint
ALERT_WEBHOOK_TOKEN=optional-bearer-secret
ALERT_NOTIFICATION_INTERVAL_MS=60000
ALERT_NOTIFICATION_COOLDOWN_MS=300000
```

O endpoint do webhook é configurado pelo operador, nunca por usuários da API. Restrinja egress e permita somente destinos confiáveis. O formato do corpo é JSON genérico; a integração de destino deve aceitar esse contrato ou usar um adaptador próprio.

## Limitações

- Métricas e estado de deduplicação são locais ao processo; cada réplica produz sua própria série de métricas e suas próprias notificações. O scraping centralizado deve coletar todas as instâncias.
- O buffer é volátil e não substitui histórico durável nem auditoria contábil.
- O webhook não implementa persistência de fila, retry exponencial durável, dashboard ou formatos específicos para plataformas de chat.


## Painel administrativo — Etapa 14

O console web está disponível em `/admin`. Ele reúne liveness/readiness, desempenho HTTP, alertas atuais, histórico recente da instância, consumo por cliente e métricas de execuções/eventos. As chamadas administrativas usam a credencial master, validada pelo backend. A interface não persiste o token no armazenamento local/sessão do navegador.

O histórico é obtido por `GET /api/v1/observability/alerts/history?limit=50` e limitado a 100 eventos em memória por instância; não é histórico durável. A rota é master-only.
