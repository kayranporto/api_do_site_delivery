# Etapa 7 — Reconciliação e observabilidade

## Reconciliação de resultados incertos

Uma execução interrupted continua sendo um estado final e não é reexecutada automaticamente. A aplicação pode consultar um endpoint externo de leitura, desde que a operação tenha um bloco reconciliation na configuração do provedor REST.

A definição da consulta aceita apenas GET. O caminho permanece no hostname HTTPS aprovado em allowedHosts e pode interpolar somente {executionId}, {idempotencyKey} ou {operationName}. O statusField identifica um caminho JSON e statusMap converte os valores externos para succeeded, failed, pending, not_found ou unknown.

A consulta é explícita: POST /api/v1/executions/:executionId/reconcile. Ela não executa comandos de escrita no provedor e não altera o estado da execução. O resultado é devolvido ao operador e armazenado como evento de auditoria. Um resultado unknown ou pending não permite inferir sucesso nem retry seguro.

## Eventos operacionais

A tabela execution_events guarda uma trilha append-only de tentativas, interrupções e reconciliações. Os eventos incluem identificadores da execução/integração, tipo, severidade, timestamp e detalhes operacionais curtos.

O repositório permite somente tipos de evento e campos conhecidos. Payload, tokens, headers, credenciais e mensagens livres de exceções são removidos antes da persistência. A gravação de telemetria é best-effort: uma indisponibilidade do event store não deve transformar uma operação externa já concluída em falha da operação.

A API permite consultar eventos por execução em GET /api/v1/executions/:executionId/events.

## Métricas

GET /api/v1/observability/metrics?windowHours=24 retorna total de execuções por estado atual, total de eventos na janela e distribuição de eventos por tipo e severidade. A janela aceita 1 a 720 horas. O endpoint exige uma credencial Bearer com o escopo `observability:read`. A credencial master mantém acesso global; chaves individuais podem ser restritas por escopos e IDs de integração.

## Limites

- Reconciliação depende de cada provedor documentar um endpoint GET/HEAD e mapear seus estados corretamente.
- A resposta externa não é prova criptográfica; a confiança depende do endpoint, TLS e autenticação configurados.
- A API não converte automaticamente a resposta em sucesso, falha ou nova tentativa; isso exige decisão de negócio e regra explícita futura.
- Eventos são append-only pela aplicação, mas ainda não há política automática de retenção/expurgo, exportação para SIEM, alertas ou dashboard.
- A persistência de eventos é best-effort e não é transacional com a alteração de estado da execução; métricas podem ficar incompletas se o banco de eventos estiver indisponível.
