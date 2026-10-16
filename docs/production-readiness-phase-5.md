# Fase 5 — Production Readiness e Go-Live Gate

Data da homologação: 2026-08-01 (America/Manaus)  
Veredito: **NOT READY FOR PRODUCTION**  
Nota geral baseada em evidências: **82/100** (auditoria inicial: 61/100)

## Resumo executivo

O repositório reconstrói corretamente um PostgreSQL 16 vazio, as 22 migrations passam em sequência e as suítes locais de unidade, integração PostgreSQL, concorrência, API, navegador e build passam contra um banco descartável. Foram encontrados e corrigidos três defeitos reais de concorrência (enqueue da outbox, replay e reset de senha), um erro de contrato HTTP em disputa serializável e uma dependência externa acidental do seed.

O go-live continua bloqueado porque o alvo Supabase configurado é remoto e não foi identificado inequivocamente como homologação. Ele possui somente 18 das 22 migrations, não contém `AuditLog` nem `OperationalHeartbeat` e ainda não recebeu os hardenings de grants, índices, outbox e observabilidade. Também não há evidência de plano Vercel compatível com o cron a cada cinco minutos, envio WhatsApp real autorizado, teste destrutivo controlado de Storage, canal externo de alertas, política comprovada de backup ou restore isolado. Nenhuma escrita, migration, mensagem, replay ou deploy foi executado nesses ambientes remotos.

## Escopo e ambiente

| Alvo | Classificação | Evidência | Operações realizadas |
|---|---|---|---|
| PostgreSQL `127.0.0.1:55432/alfa_cabelos_phase5_test` | descartável/local | container PostgreSQL 16 criado exclusivamente para a fase; nome contém `test`; guard exige `ALLOW_DESTRUCTIVE_TESTS=true` | migrations, seed, fixtures, concorrência, volume, EXPLAIN e testes |
| Supabase ref `<SUPABASE_PROD_PROJECT_REF>`, projeto exibido como `social`, região `sa-east-1`, PostgreSQL 15 | produção/desconhecido | `.env` aponta ao pooler e ao banco remoto; não existe marcador inequívoco de homologação | somente consultas de catálogo/advisors |
| Vercel `alfacabelos`, projeto `<VERCEL_PROD_PROJECT_ID>` | produção | deployment READY com target `production`, commit `a69f237622e72d5845c9a76d612e37eff089d0bf`; nenhum projeto Alfa de preview/homologação confirmado | somente leitura de projeto/deployment |

`APP_ENV`, `NODE_ENV` e `VERCEL_ENV` não estavam definidos no ambiente recebido. `CRON_SECRET` estava vazio; WhatsApp estava desabilitado e sem URL/token. O bucket configurado era `barber`. O guard novo recusa hosts remotos, nomes sem marcador de teste, nomes contendo produção e execução sem consentimento explícito. Foi provado que o URL remoto é bloqueado e o banco local é aceito.

## Migrations e banco do zero

- 22/22 arquivos validados e aplicados em ordem desde zero.
- As migrations críticas passaram: `20260730120000_lock_down_future_public_privileges`, `20260801140000_add_booking_query_indexes`, `20260801160000_harden_notification_outbox` e `20260801180000_add_operational_observability`.
- `prisma validate`, `prisma generate`, `prisma db pull --print` e `prisma migrate deploy` passaram. A introspecção encontrou 17 modelos e 11 enums; o aviso de que Prisma não representa integralmente RLS/check constraints é esperado.
- Catálogo local: 17 tabelas da aplicação mais `_prisma_migrations`; RLS ativo nas 17; triggers impedem `UPDATE` e `DELETE` de `AuditLog`; índices e constraints esperados presentes.
- Grants locais: papéis `anon`, `authenticated` e `service_role` compatíveis com a sequência Supabase; sem políticas públicas de mutação.
- Rollback lógico: migrations são forward-only; rollback operacional deve restaurar backup em alvo isolado ou aplicar migration compensatória revisada. Não existe rollback destrutivo automático.

### Drift remoto confirmado

O catálogo remoto `_prisma_migrations` contém 18 migrations, até `20260723160000_add_service_procedure_classification`. Faltam exatamente as quatro migrations críticas acima. Consequências observadas: ausência de `AuditLog` e `OperationalHeartbeat`, hardening futuro de grants não aplicado, índices da Fase 2 ausentes e outbox/observabilidade incompatíveis com o código atual.

## Testes executados

| Gate | Resultado real |
|---|---|
| Guard de ambiente | PASS: remoto recusado; local descartável aceito |
| Testes Node/TS | PASS: 62/62; nenhuma suíte skipped |
| Integração PostgreSQL | PASS: conexão, tabelas, colunas, RLS, auth cliente/admin/barbeiro, outbox, concorrência, reagendamento, cancelamento e limpeza |
| Concorrência HTTP | PASS: duas requisições ao mesmo horário resultam em `201/409` e exatamente um registro |
| E2E Playwright | PASS: 60/60 em Chrome desktop, WebKit/iPhone, Chrome/Android e Chrome/tablet |
| Lint | PASS |
| TypeScript | PASS (`tsc --noEmit`) |
| Secrets | PASS: 214 arquivos, nenhum segredo evidente rastreado |
| Migrations | PASS: 22 arquivos |
| npm audit | PASS: 0 vulnerabilidades, produção e conjunto completo |
| Build limpo | PASS: `.next` removido; 34 páginas geradas; zero erro/warning crítico e nenhuma chamada externa necessária |

Os E2E comprovaram login, sessão, RBAC, logout, open redirect, recorrência/idempotência com estado consultado no PostgreSQL, rotas protegidas, responsividade e teclado. A validação de integração comprovou criação/primeira senha, recuperação, sessões, agendamento, reagendamento, cancelamento e histórico persistido. A suíte não cobre visualmente todos os CRUDs de clientes, serviços, horários, mídia, operações e audit log; esses itens permanecem bloqueados para homologação completa, embora seus serviços e controles possuam cobertura parcial.

## Concorrência e resiliência

Passaram em PostgreSQL real:

- duas pessoas no mesmo horário: um commit e um conflito, sem duplicidade;
- dois workers com `SKIP LOCKED`: nenhum delivery compartilhado;
- confirmações simultâneas: convergência idempotente;
- cancelamentos simultâneos: estado único consistente;
- mesma série simultânea: uma série materializada;
- replay simultâneo: uma transição, segunda chamada `already_replayed`;
- reset simultâneo: um sucesso e uma rejeição segura;
- lock expirado e crash: recuperação por outro worker;
- rollback: nenhuma notificação órfã;
- lotes de 1, 10 e 59 bookings: igual número de intents, sem rede;
- timeout, 429 e 5xx: retry; erro permanente e tentativas esgotadas: DEAD.

Correções feitas durante a homologação:

1. enqueue concorrente agora usa inserção com `skipDuplicates` e leitura canônica;
2. replay e reset repetem uma transação serializável uma vez e convergem de forma idempotente;
3. `P2034` de disputa da agenda agora é exposto como `409`, não `400`;
4. logs estruturados removem telefone, e-mail, token e credenciais também em objetos aninhados;
5. seed passou a usar assets locais versionados.

## Performance real

Volume descartável: 10.000 bookings, 1.000 clientes, 10 barbeiros, 10 serviços, 5.000 notifications e 500 bloqueios. Todas as linhas de carga foram removidas no `finally`. Resultados de `EXPLAIN (ANALYZE, BUFFERS)`:

| Consulta | Plano/índice principal | Rows | Buffers hit | Execução |
|---|---|---:|---:|---:|
| agenda diária | Bitmap Index Scan `Booking_barberId_dateTimeStart_idx` | 15 | 15 | 0,153 ms |
| agenda semanal | mesmo índice | 13 | 32 | 0,217 ms |
| histórico do cliente | `Booking_clientId_dateTimeStart_idx` | 10 | 38 | 0,143 ms |
| dashboard | `Booking_dateTimeStart_idx` | 189 | 70 | 0,375 ms |
| ganhos | índice por data + `Service_pkey` | 189 | 184 | 0,654 ms |
| polling incremental | `Booking_updatedAt_idx` | 100 | 345 | 0,246 ms |
| claim da outbox | `NotificationDelivery_status_nextRetryAt_createdAt_idx`; bitmap sobre 2.009/2.005 candidatas | 2.005 | 416 | 0,897 ms |
| métricas da outbox | Seq Scan esperado para agregação das 5.005 linhas | 5.005 | 266 | 1,285 ms |
| sobreposição de bloqueios | Seq Scan sobre tabela pequena | 500 | 8 | 0,138 ms |

Não houve leitura de disco compartilhada nessa amostra; os dados estavam em cache. Os dois Seq Scans são aceitáveis nesse volume, mas devem ser acompanhados com crescimento real.

## Polling

PASS em testes determinísticos para nenhum evento, inserção/alteração/cancelamento, merge sem duplicidade, aba oculta, retorno, falha/backoff e reconciliação periódica. O índice `Booking_updatedAt_idx` foi usado no volume representativo. Não foi executado soak test de longa duração em browser; é melhoria futura.

## Worker, cron, WhatsApp e replay

### Worker

PASS local para fila vazia, item único, lote, múltiplos workers, timeout, 429, 500, permanente, DEAD, crash e lock expirado. Uma chamada real do endpoint local com WhatsApp desabilitado retornou 200 e persistiu heartbeat `notification-outbox/success`, sem chamar rede. O backlog artificial também acionou `outbox.backlog` e `outbox.oldest_pending` nos logs.

### Cron

O endpoint recusou Bearer ausente e incorreto com 401 e aceitou o segredo local com 200. O `vercel.json` pede `*/5 * * * *`. A documentação atual da Vercel informa mínimo diário no Hobby e mínimo de um minuto no Pro/Enterprise; cron é instalado e chamado apenas no deployment de produção. Portanto, o plano precisa ser confirmado como Pro/Enterprise. O deployment remoto atual corresponde ao commit anterior e não comprova esse cron. Nenhuma chamada remota foi disparada. Referências: [limites e preços do Cron](https://vercel.com/docs/cron-jobs/usage-and-pricing), [gestão, segurança e ausência de retry automático](https://vercel.com/docs/cron-jobs/manage-cron-jobs).

### WhatsApp

PASS apenas no provider simulado: Idempotency-Key, timeout, 429, 4xx permanente, 5xx transitório, número inválido e ausência de retry inline. BLOCKED no fornecedor real: `WHATSAPP_ENABLED=false`, URL/token ausentes e não há número/ambiente de homologação autorizado. `providerMessageId` real não foi obtido.

### Replay

PASS em serviço PostgreSQL para DEAD-only, idempotência concorrente, AuditLog e proibição de SENT. A rota exige ADMIN, confirmação e rate limit por implementação. O fluxo completo usuário/BARBER/ADMIN via HTTP não foi executado por falta de homologação remota segura; permanece BLOCKED como gate externo.

## Health, readiness e alertas

Testes reais em processos isolados:

| Cenário | `/api/health` | `/api/ready` |
|---|---|---|
| banco, schema e config íntegros | 200 `ok` | 200 `ready` |
| banco vazio/incompatível | 200 `ok` | 503, `schema=unhealthy` |
| banco indisponível/timeout | 503 `unhealthy` | 503, database/schema unhealthy |
| `CRON_SECRET` ausente | não aplicável | 503, `configuration=unhealthy` |

As respostas não contêm URL, host, segredo, stack trace ou mensagem do driver. Heartbeat saudável, stale, falho e never-run foram validados; backlog, fila antiga, DEAD, worker stale e latência de banco cruzam os thresholds corretos. A detecção e o log estruturado passam, mas não há integração com PagerDuty, e-mail, Slack ou outro canal; alerta externo é BLOCKED.

## Audit log

PASS para sanitização de metadata, criação de evento e proteção append-only real: tentativas Prisma de `UPDATE` e `DELETE` falharam no trigger PostgreSQL. Replay registra auditoria. Ações administrativas possuem instrumentação para booking, bloqueio, serviço, senha, mídia e replay, mas a matriz completa de cada ação via UI não foi executada; classificada como cobertura parcial.

## Supabase, RLS, grants e Storage

Consultas remotas read-only mostraram RLS ativo em todas as tabelas atuais e nenhum privilégio direto de SELECT/escrita para `anon` ou `authenticated`. O modelo server-only/deny-all explica tabelas sem policy. Entretanto, a migration de default privileges não está aplicada, logo tabelas futuras ainda não têm o hardening comprovado.

Os advisors apontaram:

- buckets públicos `box` e `pdv` com listagem ampla; o vínculo desses dados com o Alfa deve ser esclarecido;
- proteção contra senhas vazadas desabilitada;
- PostgreSQL 15.8 com patches de segurança disponíveis;
- FKs/consultas sem os índices que existem somente nas migrations locais ainda não aplicadas.

Os buckets remotos encontrados foram `barber`, `box`, `pdv` e `reviews-photos`, todos públicos. Upload, assinatura, deleção e URL reais não foram testados porque o alvo não é homologação confirmada. Localmente passaram MIME, magic bytes, extensão, dupla extensão, SVG proibido, limite, arquivo vazio/corrompido, path traversal, resolução e deleção segura. Storage remoto permanece BLOCKED.

## Backup e restore

O plano, última execução, retenção e PITR do projeto remoto não estão disponíveis nas conexões atuais e não foram inferidos. A documentação da Supabase diz que backups diários automáticos são de planos Pro/Team/Enterprise e que objetos do Storage não fazem parte do backup do banco. Logo banco e objetos exigem estratégias separadas. Referências: [backups do banco Supabase](https://supabase.com/docs/guides/platform/backups) e [download/cópia de objetos](https://supabase.com/docs/guides/storage/management/download-objects).

- Banco: BLOCKED até comprovar plano, último backup, frequência, retenção, PITR e um restore em projeto novo/isolado.
- Storage: BLOCKED até existir cópia versionada/off-site dos objetos e ensaio de restauração/reconciliação.
- Restore: não executado; nenhuma origem segura de backup e nenhum alvo Supabase descartável autorizado estavam disponíveis.

O procedimento está em `docs/backup-restore-runbook.md` com RPO provisório, RTO, validações e proibição de sobrescrever ambientes existentes.

## Segurança regressiva

PASS local: npm audit sem vulnerabilidades, varredura de secrets, queries parametrizadas/Prisma, same-origin em mutações, bloqueio de open redirect, RBAC/IDOR, rate limits, cookies HttpOnly/SameSite/Secure em produção, endpoint interno com Bearer, upload endurecido, CSP, HSTS, anti-frame, MIME sniffing e redaction de logs. O CSP de desenvolvimento permite `unsafe-eval`; o build de produção remove essa diretiva, mas ainda usa `unsafe-inline`, dívida a endurecer. Os bloqueios remotos de migration/RLS futuro e Storage impedem PASS global de segurança.

## CI

O workflow usa PostgreSQL 16 descartável, roles Supabase, migrations, guard, seed, testes Node/PostgreSQL, validação de integração, Playwright desktop/mobile, lint, TypeScript, build, audit de produção e crítico, secrets e `git diff --check`. A fase acrescentou os gates de ambiente, seed, integração e E2E que faltavam.

O YAML foi revisado e cada comando passou localmente, mas o workflow alterado não foi enviado nem executado no GitHub por restrição explícita de commit/push. Status: BLOCKED até uma execução verde no provedor.

## Matriz de configuração

Responsáveis: Plataforma = infraestrutura/segredos; Backend = comportamento da aplicação; Operações = thresholds e rotina; QA = apenas teste.

| Variável/grupo | Obrigatória | Escopo | Dev | Homolog | Produção | Sensível | Responsável |
|---|---|---|---|---|---|---|---|
| `DATABASE_URL` | sim | server-only | local | isolada | pooler | sim | Plataforma |
| `DIRECT_URL` | sim | server-only/migrations | local | isolada | direto | sim | Plataforma |
| `APP_URL` | sim em runtime | server-only | localhost | URL homol | domínio canônico | não | Plataforma |
| `NEXT_PUBLIC_APP_URL` | recomendada | frontend | localhost | URL homol | domínio canônico | não | Plataforma |
| `SUPABASE_URL` | sim para Storage | server-only | opcional | projeto homol | projeto prod | não | Plataforma |
| `SUPABASE_SERVICE_ROLE_KEY`/`SUPABASE_KEY` | sim para Storage | server-only | opcional | chave homol | chave prod | **sim** | Plataforma |
| `SUPABASE_STORAGE_BUCKET` | sim para Storage | server-only | bucket teste | bucket homol | bucket prod | não | Plataforma |
| `WHATSAPP_ENABLED` | não | server-only | false | false/true controlado | true após gate | não | Operações |
| `WHATSAPP_PROVIDER`, `WHATSAPP_API_URL`, `WHATSAPP_INSTANCE_ID` | sim se habilitado | server-only | mock/vazio | fornecedor teste | fornecedor prod | URL/ID: restrito | Plataforma |
| `WHATSAPP_API_TOKEN`, `WHATSAPP_WEBHOOK_SECRET` | sim se habilitado | server-only | vazio | segredo teste | segredo prod | **sim** | Plataforma |
| `WHATSAPP_OWNER_PHONE` | conforme eventos | server-only | número teste | autorizado | proprietário | **PII** | Operações |
| `WHATSAPP_REQUEST_TIMEOUT_MS`, `BARBERSHOP_ADDRESS` | opcional | server-only | default | configurado | configurado | endereço: PII comercial | Operações |
| `CRON_SECRET` | sim | server-only | segredo local | segredo homol | segredo prod >=16 chars | **sim** | Plataforma |
| `NOTIFICATION_BATCH_SIZE`, `NOTIFICATION_CONCURRENCY`, `NOTIFICATION_MAX_ATTEMPTS` | opcional | server-only | defaults | calibrado | calibrado | não | Operações |
| `NOTIFICATION_RETENTION_DAYS`, `NOTIFICATION_DEAD_RETENTION_DAYS` | opcional | server-only | defaults | política | política LGPD | não | Operações |
| `NOTIFICATION_REMINDER_LEAD_MINUTES`, `NOTIFICATION_REMINDER_WINDOW_MINUTES` | opcional | server-only | defaults | validado | validado | não | Operações |
| `ALERT_OUTBOX_BACKLOG`, `ALERT_OUTBOX_OLDEST_SECONDS`, `ALERT_WORKER_STALE_SECONDS`, `ALERT_DATABASE_LATENCY_MS` | opcional | server-only | defaults | calibrado | calibrado | não | Operações |
| `APP_VERSION`/`VERCEL_GIT_COMMIT_SHA` | recomendada | resposta sanitizada | opcional | automático | automático | não | Plataforma |
| `BOOKING_DIAGNOSTICS`, `OBSERVABILITY_DEBUG` | opcional | server-only | conforme debug | false salvo incidente | false salvo incidente | não | Operações |
| `APP_ENV`, `NODE_ENV`, `VERCEL_ENV`, `VERCEL_URL` | sim/automática | runtime | dev/test | preview | production | não | Plataforma |
| `ALLOW_DESTRUCTIVE_TESTS`, `RUN_DATABASE_TESTS`, `HOMOLOGATION_EXTERNAL_TESTS` | somente QA | server-only | alvo descartável | consentimento explícito | **nunca** | não | QA |
| `TEST_BASE_URL`, `CI` | somente QA/CI | test runner | local | CI/preview | não aplicável | não | QA |

## Go-live checklist

| Categoria | Status | Evidência/pendência |
|---|---|---|
| Security | BLOCKED | local passa; remote grants futuros, buckets e password protection pendentes |
| Database | BLOCKED | reconstrução local passa; alvo remoto ambíguo e em PostgreSQL desatualizado |
| Migrations | FAIL | 4 migrations ausentes no remoto |
| Auth | PASS | cliente/admin/BARBER e sessões validados em PostgreSQL + browser |
| Agenda | PASS | CRUD central, recorrência, conflito, reagendamento e cancelamento validados |
| Performance | PASS | 10k bookings/EXPLAIN com tempos e buffers reais |
| Outbox | PASS | rollback, idempotência, claim, retry, DEAD e métricas validados |
| Worker | PASS | cenários de falha, concorrência, lock recovery e heartbeat locais |
| WhatsApp | BLOCKED | nenhum envio autorizado no fornecedor real |
| Cron | BLOCKED | plano não confirmado; `*/5` requer Pro/Enterprise; remoto não exercitado |
| Observability | PASS | logs, correlação, métricas, health/readiness e heartbeat validados |
| Alerts | BLOCKED | detecção/log passa; canal externo inexistente/não homologado |
| Audit | BLOCKED | append-only e replay passam; matriz UI administrativa incompleta |
| Backup | BLOCKED | plano, última execução, retenção e Storage backup sem evidência |
| Restore | BLOCKED | restore isolado não executado |
| CI | BLOCKED | workflow ampliado, ainda sem execução hospedada verde |
| E2E | BLOCKED | 60/60 passam; CRUD visual completo de todos os painéis não coberto |
| Accessibility | BLOCKED | labels/foco/teclado/overflow passam; axe, contraste e modais não auditados integralmente |
| Environment | BLOCKED | nenhuma homologação inequívoca para Alfa |
| Secrets | PASS | nenhum segredo rastreado; respostas/logs sanitizados |
| Storage | BLOCKED | segurança de arquivo local passa; operações remotas não autorizadas |
| RLS/grants | BLOCKED | tabelas atuais negam anon/authenticated; migration de default grants ausente |

## Bloqueadores de produção

1. Aplicar, em janela aprovada e com backup verificado, as quatro migrations faltantes no Supabase correto; depois repetir catálogo, RLS, grants e smoke tests. Esta fase não autoriza aplicá-las.
2. Identificar ou criar homologação isolada de Supabase/Vercel/Storage/WhatsApp; o projeto remoto atual tem nome divergente (`social`).
3. Homologar WhatsApp real com credenciais e número de teste, comprovando `providerMessageId`, idempotência e erros.
4. Confirmar plano Vercel Pro/Enterprise ou substituir a estratégia do cron de cinco minutos; comprovar invocações, logs e heartbeat sem depender de retry da Vercel.
5. Comprovar backup do banco, retenção/PITR, cópia separada de Storage e executar restore completo em alvo novo.
6. Resolver/justificar buckets públicos e proteção de senhas vazadas; atualizar PostgreSQL conforme recomendação do fornecedor.
7. Configurar e homologar canal externo de alertas.
8. Executar o CI atualizado no GitHub e completar a matriz E2E/a11y administrativa.

## Melhorias futuras (não bloqueadoras isoladamente)

- soak test prolongado do polling e worker;
- remover `unsafe-inline` do CSP com nonce/hash;
- acompanhar Seq Scan de métricas/outbox e bloqueios conforme volume;
- adicionar axe-core e thresholds automatizados de contraste;
- versionar dashboard/SLOs e medir RPO/RTO reais após o primeiro restore drill.

## Score

| Dimensão | Nota |
|---|---:|
| Arquitetura | 85 |
| Código | 88 |
| Segurança | 75 |
| Performance | 90 |
| UX | 82 |
| UI | 80 |
| Banco | 72 |
| APIs | 87 |
| Escalabilidade | 86 |
| DevOps | 60 |
| Observabilidade | 78 |
| Testes | 90 |
| Documentação | 88 |
| Maintainability | 86 |
| **Geral** | **82/100** |

A evolução de 61 para 82 reflete apenas evidências locais novas: reconstrução total, concorrência, volume, E2E multi-device, health negativo, segurança e build. A nota não substitui gates binários; migrations remotas, cron, integrações, backup/restore e CI hospedado mantêm o veredito abaixo.

## Veredito final

**NOT READY FOR PRODUCTION**

Não houve alteração de produção, migration remota, envio real, replay remoto, exclusão remota, upgrade de plano, DNS, commit, push ou deploy. Um novo gate deve ser executado depois de resolver os oito bloqueadores, usando homologação inequivocamente isolada.
