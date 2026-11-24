# Etapa 16 — Revisão de segurança e prontidão para produção

## Controles aplicados no código

- A aplicação aceita somente `NODE_ENV=development`, `test` ou `production`; valores digitados incorretamente não podem contornar as validações de produção.
- Segredos exigem o comprimento mínimo definido, não aceitam espaços nem valores de exemplo e devem ser distintos entre API master, Redis, métricas e webhook.
- Em produção, origens CORS configuradas precisam usar HTTPS.
- URLs de webhook usam HTTPS e não podem incluir credenciais, query string ou fragmento. O segredo, quando necessário, deve ser enviado no header Authorization.
- Todas as respostas de `/api/v1`, inclusive erros de autenticação, recebem `Cache-Control: no-store`; respostas de criação/rotação de chave não devem ser armazenadas por caches intermediários.
- `trust proxy` permanece explicitamente desativado. No Render, o rate limiter pode usar somente `CF-Connecting-IP`, validado como um único IPv4/IPv6; `X-Forwarded-For` continua sem confiança.
- O CI usa actions fixadas por SHA imutável com runtime Node 24, não persiste credenciais do checkout, testa Node.js 22, 24 e 26, executa auditoria npm geral e uma auditoria mais rígida apenas das dependências de produção.
- Dependabot verifica semanalmente atualizações de dependências npm e GitHub Actions.

## Checklist obrigatório antes do primeiro deploy

1. **Runtime:** usar uma linha LTS suportada; não usar Node.js 20 ou anterior.
2. **Segredos:** gerar valores aleatórios próprios para `API_ACCESS_TOKEN`, `METRICS_ACCESS_TOKEN`, `UPSTASH_REDIS_REST_TOKEN` e `ALERT_WEBHOOK_TOKEN`, sempre distintos, guardados no gerenciador de segredos do provedor. Nunca versionar `.env`.
3. **Ambiente:** definir `NODE_ENV=production`, `DATABASE_URL`, `RATE_LIMIT_STORE=upstash`, as credenciais Redis e `METRICS_ACCESS_TOKEN`. A inicialização falha quando os requisitos obrigatórios estão ausentes.
4. **Rede:** terminar TLS no proxy da hospedagem; no Render, definir `CLIENT_IP_HEADER=cf-connecting-ip` e validar o IP de origem com testes. Manter `trust proxy` desativado; restringir `/admin`, rotas administrativas e `/metrics` por VPN/allowlist/rede privada quando possível.
5. **Banco:** usar usuário PostgreSQL com privilégio mínimo, conexão TLS conforme o provedor, backups automáticos e teste documentado de restauração. Aplicar migrations em procedimento controlado antes de iniciar a versão nova.
6. **Redis:** usar endpoint HTTPS, segredo próprio, política de acesso restrita e alertas de indisponibilidade.
7. **Provedores e webhook:** permitir egress somente aos hosts aprovados; usar segredos via cofre/variáveis `env:`; não usar URLs de webhook controladas por consumidores da API.
8. **Operação:** configurar monitoramento externo, scrape do Prometheus em cada réplica, canal de alertas, retenção de logs/auditoria e procedimento de rotação/revogação de credenciais.
9. **Entrega:** conferir CI verde, executar smoke tests em ambiente de homologação, confirmar readiness e testar rollback antes de liberar tráfego.

## Limitações que continuam fora do código

- A configuração não cria nem provisiona banco, Redis, WAF, VPN, TLS, DNS, backups, Prometheus ou o cofre de segredos.
- A política de TLS do PostgreSQL e a identidade do proxy dependem do serviço de hospedagem e precisam ser conferidas no ambiente real.
- `trust proxy` fica desligado de propósito. Para Render, `CLIENT_IP_HEADER=cf-connecting-ip` permite usar o cabeçalho dedicado fornecido pela camada Cloudflare; se esse cabeçalho estiver ausente ou inválido, o rate limiter falha fechado. Em outras hospedagens, mantenha o padrão até validar a cadeia de proxy.
- Auditoria de credenciais e histórico de alertas exigem retenção/centralização operacional; buffers em memória não são evidência durável.
- A proteção de branch, exigência de revisão por PR e configurações da conta GitHub não foram alteradas. A integração GitHub disponível não autorizou a leitura das regras de proteção do branch.
- A auditoria npm desta revisão reportou 18 alertas moderados em dependências de desenvolvimento transitivas do Jest (cadeia `glob`/`minimatch`); não houve alerta de alta ou crítica gravidade no limite aplicado. O CI também passa a exigir ausência de alertas moderados ou superiores nas dependências de produção. Os alertas de desenvolvimento permanecem registrados para atualização via Dependabot.
- O CI verifica vulnerabilidades reportadas pelo npm no momento de cada execução; isso não substitui análise contínua, SCA dedicada, análise estática, secret scanning, pentest ou revisão de configuração da hospedagem.

## Homologação técnica — Etapa 17

O job separado de integração usa PostgreSQL 16 e Redis 7 efêmeros, aplica migrations reais em banco local descartável e testa a API/worker com repositórios persistentes. A rotina de teste recusa hosts fora de loopback, base com nome diferente de `stage17_homologation` e ausência da variável explícita de reset. O Redis REST bridge é limitado a loopback, token efêmero e comandos permitidos. Nenhum sandbox ou endpoint externo de provedor é chamado.

## Recuperação e rollback — Etapa 18

A rotina automatizada `npm run verify:backup` realiza dump/restore em bases PostgreSQL locais e descartáveis, e compara fingerprints das tabelas principais. Ela não conecta em hosts remotos e recusa operar sem a base `stage17_homologation` e a confirmação `STAGING_ALLOW_DB_RESET=true`. A execução no CI demonstra a operação técnica de backup/restauração em ambiente isolado, mas não substitui backup gerenciado, PITR, retenção, criptografia ou restauração periódica do provedor real.

A atualização Dependabot de `dotenv` para 18.0.10 foi incorporada. Os 18 alertas moderados do conjunto de desenvolvimento continuam identificados e não foram escondidos por overrides inseguros; a auditoria de produção reportou zero vulnerabilidades com limite moderado. O motivo e as versões corrigidas estão documentados em `docs/backup-restore-rollback.md`.

## Resultado

Esta etapa endurece defaults e validações no repositório, mas **não declara o sistema pronto para produção**. A prontidão final depende da execução do checklist em uma infraestrutura real e de uma revisão operacional específica desse ambiente.
