# Runbooks operacionais

## Triagem comum

1. Registre início, responsável, versão, ambiente e `requestId`.
2. Consulte `/api/health`, `/api/ready` e, com sessão `ADMIN`, `/api/admin/operations/status`.
3. Correlacione logs pelo `requestId`, `notificationId` ou `bookingId`; não copie payload, telefone ou token.
4. Preserve evidências antes de mudar algo. Replay, migração, restauração e segredo exigem aprovação.
5. Ao recuperar, valide duas avaliações saudáveis e registre causa, impacto e prevenção.

## Banco indisponível ou lento

Sinais: health `503`, `database.latency`, erros de agenda. Verifique status do Supabase, pool/conexões, locks, CPU/IO e migrações recentes. Não troque `DATABASE_URL` sem validar o alvo. Recupere quando health/readiness estiverem `200` e uma criação controlada funcionar sem duplicidade.

## Worker parado

Sinais: `worker.stale`, heartbeat antigo e backlog crescente. Confirme cron, autorização, última execução e logs `notification.worker.*`. Verifique se outra execução está ativa. Execução manual requer aprovação; não habilite WhatsApp como diagnóstico. Recupere quando heartbeat tiver sucesso recente e backlog cair.

## Backlog ou latência

Sinais: `outbox.backlog`, `outbox.oldest_pending`, p95 alto. Quebre contadores por evento/estado; avalie locks antigos, rate limit/5xx, concorrência e duração. Ajustar lote pressiona banco/provedor e requer revisão. Não apague linhas. Recupere após duas avaliações abaixo do limiar.

## Notificações `DEAD`

Corrija primeiro a causa: configuração/credencial, payload/telefone inválido, autenticação, rate limit ou provedor. Revise um ID sem exibir conteúdo. Só então use replay com confirmação/justificativa. Nunca altere `SENT`, nunca faça update em massa e confira `notification.dead.replayed` no `AuditLog`.

## WhatsApp degradado

O health é inferido e não envia mensagem. Confirme categorias, status oficial, último sucesso e retries/dead. Em falha prolongada, mantenha intents duráveis e comunique o canal alternativo aprovado. Após retorno, drene com limites normais para evitar avalanche.

## Deploy com regressão

Compare versão, primeiro erro e métricas antes/depois. Confirme schema em `/api/ready`. Pare promoção e faça rollback aprovado quando necessário; não reverta migração destrutivamente. Valide health/readiness, login, slots e criação idempotente.

## Suspeita de vazamento em logs

Restrinja acesso, preserve o identificador e acione segurança/privacidade. Não replique o dado em tickets. Corrija emissor/sanitização. Se credencial apareceu, rotacione no provedor autorizado. Solicite expurgo conforme política e documente confirmação.

## Auditoria ausente ou adulteração

Compare ação, request ID, runtime e `AuditLog`. Confirme migração/trigger e privilégios da conexão. Preserve evidência e escale como segurança. Não insira evento retroativo fingindo contemporaneidade; registre nota corretiva separada.

## Perda de dados

Congele escritas somente por decisão do incidente e siga [../backup-restore-runbook.md](../backup-restore-runbook.md). Restaure primeiro em projeto novo, valide consistência e trate Storage separadamente. Não restaure sobre produção sem aprovação, comunicação e plano de retorno.

## Entrega externa de alertas

O cron avalia `outbox.backlog`, `outbox.oldest_pending`, `outbox.new_dead`, `worker.stale` e `database.latency`. Quando `ALERT_WEBHOOK_URL` está configurada, cada violação gera um `POST` HTTPS com código, severidade, valor, limiar, ambiente, instante e `requestId`; payloads, telefones e secrets não fazem parte do contrato.

O cooldown padrão é 900 segundos e pode ser ajustado por `ALERT_COOLDOWN_SECONDS` entre 60 segundos e 24 horas. O claim é persistido atomicamente em `OperationalHeartbeat` com a chave `operational-alert:<code>`, evitando duplicidade entre invocações concorrentes. `ALERT_WEBHOOK_TIMEOUT_MS` fica entre 1 e 15 segundos. `ALERT_WEBHOOK_TOKEN`, quando presente, é enviado somente no header Bearer.

Estados observáveis em `operational.alert.delivery`:

- `sent`: receptor respondeu 2xx;
- `suppressed`: o mesmo código ainda está em cooldown;
- `disabled`: receptor não configurado;
- `failed`: claim, URL, rede, timeout ou resposta não-2xx falhou.

Se o próprio banco estiver indisponível, o alerta `database.unavailable` ainda tenta o webhook e marca `deduplication=degraded`, pois o claim durável também depende do banco. Nesse estado pode haver uma entrega por execução do cron; use deduplicação adicional no receptor.

Teste somente em ambiente local ou homologação isolada com receptor controlado. Force um limiar baixo, execute uma invocação autorizada, confirme uma entrega, repita dentro do cooldown e confirme `suppressed`. Nunca aponte o webhook de teste para destinatários de produção.
