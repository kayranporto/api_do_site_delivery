# Etapa 15 — Dashboard administrativo e gestão de credenciais

## Acesso

Abra `/admin` no mesmo host da API. A página estática não contém credenciais nem dados administrativos. O operador informa a credencial master `API_ACCESS_TOKEN`; o backend valida o token nas chamadas protegidas.

O token fica apenas em memória na página. Não é enviado para `localStorage`, `sessionStorage`, cookies ou parâmetros de URL. Ao sair ou recarregar, a interface limpa a variável e solicita nova autenticação. O dashboard não é uma sessão de identidade independente: usa o token master da API.

Em produção, exponha o painel somente por HTTPS. Restrinja o acesso com VPN, allowlist de IP ou proxy de identidade sempre que possível. A credencial master tem acesso global e deve ser usada somente por operadores autorizados.

## Recursos

- **Estado dos serviços**: liveness de `/health` e readiness de `/readyz`, com dependências configuradas.
- **Desempenho HTTP**: requisições concluídas, latência p95, erros 5xx, memória RSS, distribuição de status e rotas mais utilizadas.
- **Alertas atuais**: regras disparando no momento da consulta.
- **Histórico de alertas**: transições firing/resolved e lembretes recentes da instância.
- **Consumo por cliente**: contagem diária dos últimos 30 dias, por meio do endpoint de usage.
- **Resumo operacional**: execuções por estado e eventos por tipo/severidade.
- **Criar credencial**: nome, escopos, integrações permitidas, expiração e quota.
- **Gerenciar credencial**: atualizar limites, rotacionar chave ou revogar acesso.
- **Auditoria**: eventos recentes da credencial selecionada.

A página atualiza os dados a cada 30 segundos e possui atualização manual e logout.

## Histórico de alertas

`GET /api/v1/observability/alerts/history?limit=50` é exclusivo da credencial master. O parâmetro `limit` aceita 1 a 100. A resposta inclui `meta.retention=process_memory`.

O monitor mantém no máximo 100 eventos por processo. A lista é volátil, local à instância e é apagada no reinício; ela não é compartilhada entre réplicas e não substitui uma tabela histórica persistente. As transições são registradas quando o monitor verifica as regras ou quando a rota de alertas é consultada.

## Segurança e limites

- O dashboard não grava o token no storage do navegador.
- As rotas administrativas continuam protegidas no servidor; ocultar elementos da interface não é considerado controle de acesso.
- Dados retornados da API são inseridos como texto no DOM, e não como HTML.
- Arquivos estáticos seguem a política CSP padrão do Helmet.
- Em produção, use HTTPS e restrinja o caminho administrativo à rede/identidade dos operadores.
- Métricas HTTP permanecem locais à instância, e a seleção de consumo depende da disponibilidade do Redis.
- A interface executa ações administrativas somente após interação explícita do operador; os endpoints continuam exigindo a credencial master no servidor.


## Gestão de credenciais (Etapa 15)

A área **Criar credencial** envia POST /api/v1/clients. O operador escolhe os escopos, o conjunto de integrações, a validade (1–3650 dias), a quota (1–100000 requisições) e a janela (1000–3600000 ms). Lista vazia de integrações significa nenhuma integração; a opção de acesso global envia integrationIds = null. O escopo observability:read requer a opção global por definição do modelo de autorização.

Para uma credencial selecionada, o painel permite atualizar quota por POST /api/v1/clients/:clientId/limits, rotacionar por POST /api/v1/clients/:clientId/rotate e revogar por POST /api/v1/clients/:clientId/revoke. Também consulta auditoria por GET /api/v1/clients/:clientId/audit.

A criação e a rotação retornam o segredo bruto uma única vez. O painel o mantém somente na memória da página, não usa storage, cookies ou URL e oferece cópia explícita. O segredo é ocultado automaticamente após dois minutos, ao ocultar manualmente, ao sair e ao recarregar. A API não consegue recuperar uma chave já ocultada; nesse caso, o operador deve rotacioná-la novamente.

Revogação e rotação pedem confirmação antes de executar. A rotação invalida imediatamente a chave anterior, portanto sistemas consumidores devem receber a nova chave de forma coordenada. A revogação é efetiva imediatamente. Todas as operações continuam protegidas por requireMaster no servidor; controles visuais não substituem autorização da API.
