# Etapa 18 — Revisão final, backup, restauração e rollback

## Dependências e alertas

- A atualização Dependabot de `dotenv` para `18.0.10` foi incorporada após revisão e CI da PR #1.
- A auditoria completa do npm ainda encontra 18 alertas moderados no conjunto de desenvolvimento, associados à cadeia de ferramentas do Jest (`glob` e `minimatch`). A versão atual de Jest e consumidores transitivos ainda restringem algumas dependências a faixas vulneráveis.
- Os avisos são classificados como desenvolvimento/teste; a execução `npm audit --omit=dev --audit-level=moderate` encontrou zero vulnerabilidades nas dependências de produção.
- Os avisos não foram suprimidos nem mascarados com overrides forçando majors incompatíveis. `glob` tem correção publicada a partir de 14.0.2 e `minimatch` a partir de 11.0.1. O projeto deve reavaliar quando Jest/test-exclude aceitar essas versões sem overrides de major.

Referências: [GHSA-3g3m-2fjr-6pw4](https://github.com/isaacs/node-glob/security/advisories/GHSA-3g3m-2fjr-6pw4), [GHSA-g3hv-75wg-m249](https://github.com/isaacs/minimatch/security/advisories/GHSA-g3hv-75wg-m249).

## Prova automatizada de backup e restauração

O CI executa `npm run verify:backup` depois da homologação PostgreSQL/Redis. O comando:

1. aceita apenas host local, database `stage17_homologation` e `STAGING_ALLOW_DB_RESET=true`;
2. gera um arquivo temporário PostgreSQL custom-format via `pg_dump` executado na imagem `postgres:16-alpine`, alinhando a versão cliente ao servidor de homologação;
3. restaura em uma base separada `stage18_restore_verification`;
4. compara contagens e fingerprints MD5 de seis tabelas, incluindo migrations, integrações, execuções, eventos e credenciais/auditoria;
5. remove a base de restauração e o arquivo temporário mesmo se houver falha.

O script usa Docker para executar `pg_dump`/`pg_restore` com cliente PostgreSQL 16, recusa sobrescrever uma base de restauração já existente e não aceita URLs remotas. Ele não é um fluxo de backup para produção; o runner precisa ter Docker disponível. O arquivo temporário pode conter todos os dados da base de homologação e é apagado ao final do processo.

## Procedimento recomendado para backups de produção

1. Use o backup gerenciado do provedor PostgreSQL com PITR quando disponível, ou uma rotina `pg_dump -Fc` aprovada pela equipe de operação.
2. Proteja os backups com criptografia em repouso, controle de acesso mínimo, retenção imutável e armazenamento separado da conta de execução da API.
3. Defina formalmente RPO e RTO conforme o impacto do negócio; configure alertas de falha e monitore a idade do último backup válido.
4. Não coloque URLs de conexão, senhas, tokens ou arquivos de backup no Git, em artefatos públicos de CI ou no diretório servido pela API.
5. Faça restaurações periódicas em uma instância isolada, nunca sobre o banco de produção, e valide migrations, contagens, consistência e consultas críticas.
6. Documente responsável, data, duração, tamanho, origem, destino, resultado e evidências da restauração sem incluir segredos.

## Plano de rollback da aplicação

1. Interrompa a promoção de tráfego e registre o commit/imagem atualmente implantado.
2. Pause workers para impedir que novas tentativas ou operações externas sejam iniciadas durante a troca.
3. Preserve logs, métricas, IDs de request e o estado do banco; não apague execuções nem eventos para 'limpar' a falha.
4. Reverta a aplicação para o artefato anterior previamente testado e verifique `/health`, `/readyz`, autenticação, leitura de integrações e consumo do Redis.
5. Reative o worker somente depois de confirmar que a versão anterior é compatível com o schema atual e com os estados persistidos.
6. Se o defeito envolver corrupção/perda de dados, não tente compensar com rollback do código. Abra procedimento de recuperação de banco, congele escritas, estime perda desde o ponto de backup e restaure em ambiente isolado para validação antes de qualquer troca do endpoint.
7. Registre a decisão, RPO efetivo, impacto e aprovação operacional.

## Compatibilidade de migrations

As migrations são versionadas até `005_api_client_lifecycle`; o servidor verifica a versão do schema, mas não migra automaticamente. Não existem migrations down/rollback automáticas neste repositório. Portanto, a reversão da aplicação só é permitida quando a versão anterior é compatível com o schema 005. Para alterações incompatíveis ou destrutivas, exija restauração de snapshot validado e plano específico de migração.

## Critérios de saída da Etapa 18

- [x] Atualização segura do dotenv incorporada.
- [x] Auditoria de produção sem achados moderados ou superiores.
- [x] CI documenta os alertas moderados de dependências de desenvolvimento sem forçar downgrade.
- [x] Teste isolado de dump/restore e verificação de integridade adicionado ao CI.
- [x] Runbook de rollback e recuperação documentado.
- [ ] Backup gerenciado/PITR configurado no provedor real.
- [ ] Restauração do backup real executada e aprovada pela operação.
- [ ] RPO/RTO definidos pelo responsável do serviço.
- [ ] Estratégia de rollback validada no ambiente de homologação hospedado.

A Etapa 18 fecha a revisão técnica do repositório; não representa aprovação automática de produção. Os quatro itens finais dependem da infraestrutura e de aprovação operacional.
