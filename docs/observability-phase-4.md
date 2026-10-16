# Fase 4 — Observabilidade e operação

## Resultado e limites

Esta fase adiciona observabilidade sem mudar UI nem regras de agendamento. O sistema agora tem logs JSON sanitizados, correlação por requisição, health/readiness, heartbeat durável do worker, métricas agregadas da outbox, alertas por limiar, auditoria append-only e replay administrativo individual de mensagens `DEAD`.

Nenhuma integração externa, alerta real, replay, restauração, backup, migração remota ou deploy foi executado. Sentry/OpenTelemetry ficam como evolução deliberada: instalar sem projeto, DSN, retenção e regras de scrub aprovadas aumentaria custo e risco de dados pessoais sem fechar o circuito de incidentes.

## Inventário dos logs

| Origem | Classificação | Decisão |
| --- | --- | --- |
| Agendamento, disponibilidade, listagens e worker | operacional | JSON com `event`, `requestId`, duração, IDs técnicos e contadores |
| Retry, `DEAD`, heartbeat falho e limiares violados | alerta | `warn`/`error`, código estável e valor; integração externa pendente |
| Login, recuperação e controles de origem/rate limit | segurança | somente resultado/categoria e identificadores opacos ou hash |
| Criação/edição/exclusão administrativa e replay | auditoria | tabela `AuditLog`; sem nome, telefone, e-mail, mensagem ou payload |
| `console.error(error)` disperso em APIs | perigoso | substituído nos caminhos críticos por serialização sem stack, credenciais ou resposta bruta |
| Error boundaries no navegador | diagnóstico local | continuam no console do navegador; não formam trilha operacional do servidor |

`lib/observability/logger.ts` mascara telefones, remove chaves de senha/token/cookie/autorização/DSN/credencial e sanitiza URLs PostgreSQL. Objetos `Error` guardam somente nome e mensagem limitada; stack não é emitida. O logger não deve receber snapshots de clientes nem mensagens da outbox, mesmo com essa defesa.

## Correlação e logs

O `proxy.ts` cria ou propaga `x-request-id` para rotas dinâmicas e o devolve na resposta. Apenas um ID de plataforma com formato limitado é confiado; entrada arbitrária do cliente é sobrescrita no proxy. Server Actions geram UUID quando não há cabeçalho. O mesmo ID acompanha intents da outbox, logs e auditoria.

Os logs de runtime da Vercel incluem saída de funções e `console`, mas têm limites por requisição e retenção dependente do plano. Portanto, `AuditLog` e `OperationalHeartbeat` não dependem da retenção da hospedagem. Para retenção maior e alertas ativos, configure Log Drain/Sentry aprovado e aplique as mesmas regras de scrub.

## Endpoints operacionais

| Endpoint | Proteção | Conteúdo | HTTP |
| --- | --- | --- | --- |
| `GET /api/health` | público | versão, status/latência do banco e `requestId`; sem erro bruto | `200` saudável, `503` indisponível |
| `GET /api/ready` | público | banco, compatibilidade do schema e categorias de configuração ausente | `200` pronto, `503` não pronto |
| `GET /api/admin/operations/status` | cookie admin | métricas da outbox, heartbeat, estado inferido do WhatsApp e alertas | `200`, `401` sem sessão |
| `POST /api/admin/notifications/replay` | admin, mesma origem e rate limit | replay de um ID `DEAD` após confirmação literal e justificativa | `200`, `400/401/403/409/429` |

Health checks não enviam WhatsApp e não expõem host, query, secret, DSN ou mensagem de exceção. `ready` verifica se `AuditLog`, `OperationalHeartbeat` e a correlação da outbox existem, evitando considerar pronta uma versão sem migração.

## Métricas e alertas

As métricas são calculadas no PostgreSQL, sem carregar a fila na memória: quantidade por estado/tipo, backlog, idade do item mais antigo, retries, `DEAD`, taxas de sucesso/erro, média e p95 de entrega em 24 horas e último heartbeat do worker.

| Código | Condição padrão | Severidade |
| --- | --- | --- |
| `outbox.backlog` | backlog maior que 50 | warning |
| `outbox.oldest_pending` | item mais antigo acima de 15 min | critical |
| `outbox.new_dead` | ao menos um novo `DEAD` em 24 h | critical |
| `worker.stale` | nunca executou ou último sucesso acima de 15 min | critical |
| `database.latency` | indisponível ou acima de 500 ms | critical |

Os valores podem ser alterados por `ALERT_*`. Hoje o sistema registra a violação e a apresenta na rota administrativa; isso não equivale a notificação externa. Um receptor futuro deve deduplicar por código e exigir duas avaliações saudáveis para resolver, evitando flapping.

SLOs iniciais para revisão após 30 dias:

- disponibilidade mensal do fluxo de consulta/criação: 99,5%;
- p95 das APIs de agenda: até 1,5 s;
- 99% das notificações aceitas pela outbox enviadas em até 15 min quando o provedor estiver saudável;
- zero evento administrativo crítico sem `AuditLog`.

## Heartbeat, auditoria e replay

O worker grava `running`, `success` ou `failure` em `OperationalHeartbeat`. A gravação é best effort para não impedir envio por falha de telemetria. O status do WhatsApp é inferido da configuração, último `SENT`, retries e `DEAD`; o health check não chama o provedor.

`AuditLog` registra ator, ação, recurso, `requestId`, metadados sanitizados e horário. RLS/grants bloqueiam papéis públicos; trigger impede `UPDATE` e `DELETE`, tornando a trilha append-only para a aplicação. O proprietário do banco ainda pode desabilitar o trigger, logo a garantia também depende do controle de acesso da plataforma.

Algumas Server Actions legadas gravam auditoria logo após a mutação, em transação separada; se o banco falhar entre operações, pode haver lacuna. O replay é atômico com a auditoria. Evolução recomendada: mover cada mutação administrativa e evento para a mesma transação de domínio.

Replay exige sessão `ADMIN`, origem válida, no máximo cinco tentativas/minuto, confirmação `REPLAY_DEAD_NOTIFICATION`, justificativa curta e ID individual. Somente `DEAD` passa para `RETRY`; `SENT`, duplicidade e repetição são rejeitados. Não existe replay em massa.

## Retenção, LGPD e custo

- Runtime logs: mínimo do plano; não usá-los como arquivo de auditoria.
- `AuditLog`: alvo de 24 meses, sujeito à política jurídica; arquivar de forma imutável antes de expurgo aprovado.
- `OperationalHeartbeat`: o modelo atual guarda somente o último estado por worker.
- Outbox: proposta de 90 dias para `SENT` e 365 para `DEAD`; limpeza continua desativada até aprovação.
- Não registrar telefone, e-mail, nome, observação, mensagem, token, cookie ou payload bruto.

## Implantação segura

1. Revisar a migração `20260801180000_add_operational_observability` e os limiares.
2. Aplicá-la em banco descartável e executar a integração.
3. Configurar `APP_VERSION`, `CRON_SECRET` e `ALERT_*` sem expor valores.
4. Fazer deploy e validar `/api/health` e `/api/ready`.
5. Validar a rota administrativa e heartbeat sem envio sintético.
6. Só depois configurar destino externo de logs/alertas e testar um alerta controlado.

Runbooks: [runbooks/operations.md](runbooks/operations.md). Backup: [backup-restore-runbook.md](backup-restore-runbook.md).
