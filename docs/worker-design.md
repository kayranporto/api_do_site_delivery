# Etapa 6 — Worker e recuperação segura

## Processo separado

A API HTTP e o worker são processos independentes e compartilham o PostgreSQL. Para iniciar:

- **npm run worker** executa polling contínuo.
- **npm run worker:once** processa um ciclo e encerra.

O worker processa execuções antigas primeiro e depois reivindica retries vencidos. Os ciclos não se sobrepõem dentro do mesmo processo. Ao receber SIGINT ou SIGTERM, o worker para de agendar ciclos e aguarda o ciclo ativo antes de fechar o pool.

## Configuração

| Variável | Padrão | Limites |
|---|---:|---:|
| WORKER_INTERVAL_MS | 5000 | 250–300000 |
| WORKER_BATCH_SIZE | 20 | 1–100 |
| WORKER_STALE_BATCH_SIZE | 50 | 1–100 |
| WORKER_STALE_AFTER_MS | 300000 | 10000–86400000 |
| WORKER_LEASE_MS | 180000 | 1000–900000 |
| DATABASE_POOL_MAX | 10 | 1–50 |

O worker exige DATABASE_URL e a versão atual do schema. Aplique migrations antes de iniciar a API ou o worker.

## Leases e fencing

Execuções novas recebem lease antes de começar o efeito externo. Retries e recuperação de execuções antigas usam reivindicação atômica com FOR UPDATE SKIP LOCKED. O lease é renovado durante a chamada do provedor. O repositório usa fencing token: uma instância cujo lease foi substituído não consegue gravar o estado final por cima do worker que assumiu depois.

O adaptador REST recebe um AbortSignal combinado ao timeout para interromper uma requisição quando o lease é perdido. Adaptadores de provedor personalizados também devem respeitar command.signal. Para que retries sejam deduplicados no serviço externo, configure `idempotencyHeaderName` no provedor REST com o header aceito pelo fornecedor (por exemplo, `Idempotency-Key`); sem essa configuração, a chave não é encaminhada pelo adaptador REST.

## Recuperação conservadora

O worker procura:
- execuções pending cuja criação ultrapassou WORKER_STALE_AFTER_MS;
- execuções running cuja última tentativa começou antes do cutoff.

Elas são marcadas como interrupted. Uma tentativa running é fechada com errorCode EXECUTION_INTERRUPTED. O worker não repete automaticamente essas operações: o provedor pode ter concluído a ação mesmo que a aplicação tenha caído antes de salvar a resposta. A reconciliação precisa consultar o sistema externo ou depender de uma chave idempotente aceita por ele.

Execuções interrupted são finais e permanecem disponíveis para consulta. Não são incluídas na fila de retries.

## Eventos operacionais

O worker e a camada de aplicação registram início/fim de tentativas, falhas e interrupções em execution_events. O armazenamento é append-only para o fluxo da aplicação; política de retenção e expurgo do banco deve ser definida pelo operador.

## Limites conhecidos

- O worker precisa ser iniciado e supervisionado pelo ambiente de implantação; não há supervisor ou serviço gerenciado provisionado pelo repositório.
- Execuções interrompidas podem ser consultadas manualmente pela rota autenticada de reconciliação; não há consultas automáticas periódicas.
- Um provedor customizado que ignore command.signal pode continuar executando após a perda do lease; o fencing impede gravações obsoletas no banco, mas não desfaz efeitos externos.
- A garantia externa não é exactly-once. O provedor precisa aceitar e respeitar uma chave de idempotência para eliminar duplicidades em janelas de falha.
- Há métricas agregadas básicas via API; ainda não há painel, alertas ou fila de dead-letter.
