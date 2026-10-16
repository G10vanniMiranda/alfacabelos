# Fase 6B — Homologação isolada e fechamento de bloqueadores

Data da verificação: 2026-09-04 (America/Manaus)

Veredito: **NOT READY FOR PRODUCTION**
Nota baseada em evidências: **84/100** (inicial: 61/100; Fase 5: 82/100)

## Verdict

A aplicação permanece **NOT READY FOR PRODUCTION**. O bloqueador raiz continua sendo a inexistência de uma homologação ALFA-CABELOS isolada: não há projeto Supabase nem projeto Vercel separado para o ALFA. Sem esse alvo não é seguro aplicar migrations, criar fixtures, testar RLS/Storage, enviar WhatsApp, executar cron/alerta real ou ensaiar restore.

Foram fechadas duas lacunas locais: entrega externa de alertas via webhook HTTPS com cooldown durável e validação fail-fast da identidade/configuração de ambientes estritos. Nenhuma operação de escrita remota foi executada.

## Blockers Before

Antes desta wave, os bloqueadores eram: dependências/lockfile sem gate atual consolidado, ausência de homologação isolada, drift de migrations, CI hospedada vermelha, Evolution/cron/alertas não homologados, backup/restore sem ensaio e E2E/a11y sem alvo seguro.

## Blockers After

| Blocker | Antes | Depois | Evidência atual |
| --- | --- | --- | --- |
| Dependências/lockfile | OPEN | PARTIALLY RESOLVED | `npm ls --all` e build passam; audit atual ficou UNKNOWN por bloqueio de egress |
| Homologação isolada | OPEN | OPEN | nenhum `alfa-cabelos-homolog` no Supabase ou Vercel |
| Paridade de migrations | OPEN | OPEN | repo 22; produção 18; homologação inexistente |
| CI hospedada | OPEN | OPEN | único run no HEAD, `30584025465`, concluiu `failure` |
| Evolution real | PARTIALLY RESOLVED | OPEN | `.env` atual mantém WhatsApp desabilitado e sem URL/token/instance; conexão externa alegada não foi comprovada |
| Cron a cada 5 minutos | PARTIALLY RESOLVED | PARTIALLY RESOLVED | time Vercel Pro e expressão válida; execução/heartbeat no candidato não existem |
| Alertas externos | OPEN | PARTIALLY RESOLVED | implementação, testes e cooldown passam; receptor e entrega real não configurados |
| Backup do banco/PITR | OPEN | UNKNOWN | capacidade do plano documentada; configuração e última execução não acessíveis nesta sessão |
| Backup do Storage | OPEN | PARTIALLY RESOLVED | inventário e estratégia operacional definidos; nenhuma cópia/restore executado |
| Restore isolado | OPEN | OPEN | não há alvo novo, vazio e autorizado |
| RLS/Storage real | OPEN | OPEN | produção auditada read-only; testes mutáveis de homologação impossíveis |
| E2E/a11y final | OPEN | OPEN | não há banco local descartável nem deployment de homologação atual |
| Aprovação de release | OPEN | OPEN | hard gates continuam falhando |

## Local Changes

- entrega externa de alertas por webhook HTTPS, com payload sanitizado, timeout e Bearer opcional;
- claim atômico e cooldown durável em `OperationalHeartbeat`, com modo degradado explícito quando o banco está indisponível;
- integração dos alertas no worker, inclusive para falha de banco durante o rate limit;
- validação fail-fast de configuração e identidade de ambiente em runtime estrito;
- atualização de `.env.example`, runbook operacional e estratégia de backup/restore de Storage;
- testes unitários para entrega, supressão, falhas, destinos privados e configuração de homologação.

## Claim Verification

| Claim do handoff | Classificação | Evidência |
| --- | --- | --- |
| O worktree deve ser preservado e já continha mudanças | EVIDENCE CONFIRMED | `git status` continua extenso e sem normalização/reversão |
| Não existe homologação ALFA inequivocamente isolada | EVIDENCE CONFIRMED | inventário read-only de Supabase e Vercel por IDs; o alvo com nome homolog pertence a outra aplicação |
| Produção está em 18/22 migrations e sem os objetos finais | EVIDENCE CONFIRMED | catálogo remoto read-only e lista local de 22 migrations |
| RLS/grants atuais e default privileges amplos | EVIDENCE CONFIRMED | consultas read-only ao catálogo da produção |
| Alert delivery, cooldown, fail-fast e edge case do rate limit existem | EVIDENCE CONFIRMED | diff, testes, lint, TypeScript e build inspecionados novamente |
| 55 testes passam e 12 integrações PostgreSQL ficam SKIP | EVIDENCE CONFIRMED | `npm test`: 67 total, 55 PASS, 12 SKIP, 0 FAIL |
| Docker/psql não permitem PostgreSQL descartável | EVIDENCE CONFIRMED | daemon Docker ausente e comando `psql` indisponível nesta continuação |
| Audit atual não deve ser classificado como FAIL | EVIDENCE CONFIRMED | endpoint inacessível no sandbox e execução externa recusada pelo controle do ambiente |
| Audit anterior apontou zero vulnerabilidades | EVIDENCE STALE | baseline histórico do Dependency Recovery Gate; não substitui audit atual |
| CI atual não está verde | EVIDENCE CONFIRMED | run e job consultados novamente por API read-only |
| Backup/PITR efetivo e Evolution de produção estão operacionais | NOT VERIFIED | configuração/execução remota atual não foi comprovada |
| Alguma evidência do handoff foi contradita | CONTRADICTED: NONE | nenhuma divergência material encontrada |
| Nenhuma operação proibida foi realizada nesta wave | EVIDENCE CONFIRMED | histórico operacional da sessão; zero staged files e HEAD local igual a `origin/main` |

## Environment Isolation

| Recurso | Produção | Homologação | Estado |
| --- | --- | --- | --- |
| Supabase project ref | `<SUPABASE_PROD_PROJECT_REF>` (`social`) | inexistente | FAIL |
| Database host/ref | `db.<SUPABASE_PROD_PROJECT_REF>.supabase.co`; pooler `<SUPABASE_POOLER_HOST>` | inexistente | FAIL |
| PostgreSQL | 15.8.1.100, região `sa-east-1` | inexistente | FAIL |
| Storage | projeto acima; bucket ALFA configurado `barber` | inexistente | FAIL |
| Vercel project | `<VERCEL_PROD_PROJECT_ID>` (`alfacabelos`) | inexistente | FAIL |
| Vercel team/plan | `<VERCEL_TEAM_ID>`, Pro | mesmo time pode hospedar projeto separado | PASS apenas para capacidade |
| Branch/artifact | `main`, `a69f237622e72d5845c9a76d612e37eff089d0bf` | inexistente | FAIL |
| Domínio | `alfacabelos.vercel.app` | inexistente | FAIL |
| `APP_ENV` | ausente no arquivo local; remoto não comprovado | inexistente | FAIL |
| Evolution sandbox | configuração local incompleta | inexistente | FAIL |
| `CRON_SECRET` | ausente no arquivo local; remoto não comprovado | inexistente | FAIL |

O projeto Supabase `<SUPABASE_OTHER_APP_PROJECT_REF>` e o projeto Vercel `<VERCEL_OTHER_APP_PROJECT_ID>` têm nome `<homologação de outra aplicação>` e pertencem a outra aplicação. Não podem ser reutilizados.

## Supabase

O projeto de produção identificado é `<SUPABASE_PROD_PROJECT_REF>` (`social`), PostgreSQL 15.8.1.100 em `sa-east-1`. Todas as consultas desta wave foram read-only; nenhuma migration, grant, policy, configuração ou objeto remoto foi alterado.

## Schema Parity

| Verificação | Repo | Homologação | Produção |
| --- | --- | --- | --- |
| Migrations | 22 | N/A | 18 |
| `Booking.updatedAt` | esperado | N/A | ausente |
| índices de query da Fase 2 | esperados | N/A | ausentes |
| outbox hardened/locking | esperado | N/A | ausente |
| `providerMessageId` | esperado | N/A | ausente |
| `requestId`/replay | esperado | N/A | ausente |
| `AuditLog` + trigger append-only | esperado | N/A | ausente |
| `OperationalHeartbeat` | esperado | N/A | ausente |
| default privileges endurecidos | esperado | N/A | não aplicado |

## Migrations

Faltam exatamente:

1. `20260730120000_lock_down_future_public_privileges`;
2. `20260801140000_add_booking_query_indexes`;
3. `20260801160000_harden_notification_outbox`;
4. `20260801180000_add_operational_observability`.

As dez verificações diretas dos objetos críticos retornaram `present=false`. Nenhuma migration foi aplicada remotamente.

## RLS

- RLS está habilitado nas 15 tabelas ALFA atualmente existentes em produção.
- Essas 15 tabelas têm zero policies, coerente com o acesso exclusivamente server-side por Prisma.
- `anon` e `authenticated` têm zero grants diretos nessas tabelas; `service_role` tem os privilégios esperados.
- Default privileges do proprietário ainda concedem tabelas, sequências e funções futuras a `anon`/`authenticated`; a migration de hardening permanece pendente.

## Storage

Inventário read-only atual do projeto compartilhado:

| Bucket | Público | Objetos | Bytes | Imagens | Vídeos | Relação com ALFA |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| `barber` | sim | 8 | 2.179.482 | 7 | 0 | configurado pelo ALFA |
| `box` | sim | 36 | 35.897.832 | 26 | 7 | outra aplicação/UNKNOWN |
| `pdv` | sim | 2 | 70.854 | 1 | 0 | outra aplicação/UNKNOWN |
| `reviews-photos` | sim | 0 | 0 | 0 | 0 | outra aplicação/UNKNOWN |

Upload, MIME falso, magic bytes, SVG, corrupção, tamanho, delete, traversal e URL externa não foram testados remotamente. O plano separado de backup agora exige destino externo versionado, manifesto SHA-256, reconciliação e restore periódico; execução permanece OPEN.

## CI

GitHub `G10vanniMiranda/alfacabelos`, branch `main`, HEAD `a69f237622e72d5845c9a76d612e37eff089d0bf`.

O único workflow remoto para esse SHA é [run 30584025465](https://github.com/G10vanniMiranda/alfacabelos/actions/runs/30584025465), concluído com `failure` em 2026-07-30. O único job, `quality-and-security` (`91011017695`), falhou em `Install locked dependencies`; audit, secret scan, lint, typecheck, Prisma, migrations, PostgreSQL efêmero, testes, build e whitespace ficaram `skipped`. Não existe execução verde da CI atual não publicada. O workflow local usa Node 20.19.0, compatível com o requisito `>=20.9.0` do Next.js instalado; a Vercel está configurada com Node 24.x.

## Evolution

| Camada | Estado | Evidência |
| --- | --- | --- |
| Provider/outbox em código | IMPLEMENTED | timeout, classificação, idempotency header, `providerMessageId`, retry e DEAD |
| Configuração local | NOT CONNECTED | `WHATSAPP_ENABLED=false`; URL, token e instance ausentes |
| Homologação | NOT HOMOLOGATED | sem sandbox ALFA, envio autorizado ou `providerMessageId` atual |
| Produção | NOT VERIFIED | nenhuma evidência atual de configuração/entrega remota |
| Worker | IMPLEMENTED LOCALLY | unitários passam; 12 testes PostgreSQL foram SKIP por falta de banco descartável |
| Cron | CONFIGURED LOCALLY | `*/5 * * * *`, rota Bearer e plano Pro; não publicado no candidato |

## Worker

O worker está implementado localmente e participa do tratamento comum de falhas, inclusive quando o rate limit falha por indisponibilidade do banco. A integração PostgreSQL permanece bloqueada sem banco descartável.

## Cron

A documentação Vercel confirma que cron é definido no deployment de produção do projeto e que `CRON_SECRET` chega como Bearer: [manage cron jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs). Isso não substitui uma execução real no projeto de homologação.

## Alerts

Foi implementado um canal webhook genérico sem nova dependência ou migration:

- payload sanitizado com código, severidade, valor, limiar, ambiente, instante e `requestId`;
- timeout configurável entre 1 e 15 segundos;
- cooldown de 60 segundos a 24 horas, padrão 15 minutos;
- claim atômico em `OperationalHeartbeat` por `operational-alert:<code>`;
- estados `sent`, `suppressed`, `disabled` e `failed`;
- falha de alerta não derruba o processamento da outbox;
- banco indisponível usa envio degradado sem claim durável e exige deduplicação adicional no receptor.

Entrega real continua BLOCKED porque `ALERT_WEBHOOK_URL` não está configurada e não existe homologação.

## Backup

Segundo a documentação atual da Supabase, projetos Pro recebem backups diários com sete dias de retenção; PITR é add-on e exige compute Small ou superior. Storage não faz parte do backup do banco: [Database Backups](https://supabase.com/docs/guides/platform/backups).

Isso prova capacidade, não configuração. Último backup, retenção efetiva, PITR e pontos recuperáveis do projeto `<SUPABASE_PROD_PROJECT_REF>` permanecem UNKNOWN.

## Restore

Nenhum restore foi executado. Um restore real só pode ocorrer em alvo novo, vazio, isolado e explicitamente autorizado.

## E2E

Os 55 testes sem banco passaram; 12 integrações PostgreSQL ficaram `SKIP`. Docker não está disponível e `psql` não está instalado. Como `.env` aponta para produção compartilhada, o guard impede corretamente fixtures, integration tests e Playwright destrutivo.

Não existe candidate deployment de homologação para validar login, agendamento, CRUD administrativo, operations/replay, AuditLog, teclado, foco, labels, ARIA e mobile. Estado: BLOCKED. Nenhuma violação foi inventada nem corrigida sem reprodução.

## Accessibility

A validação real de teclado, foco, labels, ARIA e viewport mobile permanece BLOCKED pelo mesmo motivo: não há deployment candidato nem banco descartável seguro para os fluxos autenticados e mutáveis.

## Build / Runtime Isolation

O build limpo passou com 34 rotas, sem depender de Supabase, Evolution, cron ou webhook online. A validação crítica ocorre em runtime por `/api/ready`; builds não exigem secrets.

Ambientes production/homologation agora exigem em runtime: `APP_ENV` explícito, URLs HTTPS, `DIRECT_URL`, identidade consistente de Supabase, service role/bucket, `CRON_SECRET` com pelo menos 16 caracteres e receptor HTTPS público de alertas. WhatsApp só é exigido quando habilitado.

## Environment Matrix

| Variable | Required | Environment | Server-only | Secret | Validation |
| --- | --- | --- | ---: | ---: | --- |
| `APP_ENV` | sim | todos; `homologation`/`production` explícitos | sim | não | enum operacional/fail-fast |
| `DATABASE_URL` | sim | todos | sim | sim | URL válida; ref coerente em ambiente estrito |
| `DIRECT_URL` | sim | homolog/produção/migrations | sim | sim | URL válida; ref coerente |
| `APP_URL` | sim em runtime | todos | sim | não | HTTPS em homolog/produção |
| `NEXT_PUBLIC_APP_URL` | recomendada | todos | não | não | URL pública; nunca contém secret |
| `SUPABASE_URL` | sim | homolog/produção | sim | não | HTTPS e hostname igual ao ref esperado |
| `SUPABASE_PROJECT_REF` | sim | homolog/produção | sim | não | cruza Supabase e URLs de banco |
| `SUPABASE_SERVICE_ROLE_KEY` | sim | homolog/produção | sim | sim | presença; nunca `NEXT_PUBLIC_*` |
| `SUPABASE_STORAGE_BUCKET` | sim | homolog/produção | sim | não | bucket do ambiente exato |
| `WHATSAPP_ENABLED` | sim | todos | sim | não | false por padrão |
| `WHATSAPP_PROVIDER`/`WHATSAPP_API_URL`/`WHATSAPP_INSTANCE_ID` | se habilitado | homolog/produção | sim | restrito | configuração completa e sandbox antes de produção |
| `WHATSAPP_API_TOKEN`/`WHATSAPP_WEBHOOK_SECRET` | se habilitado | homolog/produção | sim | sim | presença, escopo e rotação |
| `WHATSAPP_OWNER_PHONE` | conforme evento | homolog/produção | sim | PII | único número de teste autorizado em homologação |
| `CRON_SECRET` | sim | homolog/produção | sim | sim | mínimo 16 caracteres; Bearer |
| `ALERT_WEBHOOK_URL` | sim | homolog/produção | sim | sim | HTTPS público, sem userinfo/rede privada |
| `ALERT_WEBHOOK_TOKEN` | opcional | homolog/produção | sim | sim | somente header Bearer |
| `ALERT_COOLDOWN_SECONDS` | opcional | homolog/produção | sim | não | inteiro 60–86400 |
| `ALERT_WEBHOOK_TIMEOUT_MS` | opcional | homolog/produção | sim | não | inteiro 1000–15000 |
| `ALERT_*` thresholds | opcional | todos | sim | não | inteiro positivo/default seguro |
| `APP_VERSION`/`VERCEL_GIT_COMMIT_SHA` | recomendada | deploy | sim | não | evidência do artifact |
| `ALLOW_DESTRUCTIVE_TESTS`/`RUN_DATABASE_TESTS`/`HOMOLOGATION_EXTERNAL_TESTS` | somente teste | local descartável ou homolog autorizada | sim | não | guard independente; nunca produção |

## Validation

| Gate | Resultado atual |
| --- | --- |
| Teste focado de observabilidade | PASS: 11/11 |
| Unitários completos | PASS parcial: 55 PASS, 12 SKIP PostgreSQL, 0 FAIL |
| TypeScript | PASS |
| ESLint | PASS |
| Prisma schema | PASS |
| Migrations | PASS: 22 |
| Sensitive files | PASS: 231 arquivos, zero segredo evidente |
| `npm ls --all` | PASS |
| Audit npm atual | UNKNOWN: egress para registry rejeitado pelo ambiente |
| Build limpo | PASS: 34 rotas |
| PostgreSQL integration | BLOCKED: nenhum alvo local descartável disponível |
| Playwright desktop/mobile | BLOCKED: fixtures exigiriam escrita no banco compartilhado |
| CI hospedada | FAIL: run remoto atual vermelho |

## Security

- Advisors atuais ainda apontam leaked-password protection desabilitada e PostgreSQL 15.8 com patches disponíveis: [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) e [upgrade](https://supabase.com/docs/guides/platform/upgrading).
- O webhook de alertas aceita somente HTTPS, sem credenciais na URL, e recusa localhost, loopback, link-local, CGNAT e redes privadas IPv4/IPv6.
- Payload e logs não incluem secrets ou PII; a varredura local verificou 231 arquivos sem segredo evidente.

## Score

| Categoria | Nota |
| --- | ---: |
| Arquitetura | 90 |
| Código | 91 |
| Segurança | 85 |
| Performance | 88 |
| UX | 84 |
| UI | 84 |
| Banco | 70 |
| APIs | 88 |
| Escalabilidade | 86 |
| DevOps | 62 |
| Observabilidade | 82 |
| Testes | 82 |
| Documentação | 92 |
| Maintainability | 90 |
| **Média** | **84** |

O score não compensa hard gates: CI vermelha, ausência de homologação e drift remoto mantêm o veredito negativo.

## Go-Live Checklist

| Gate | Estado |
| --- | --- |
| Dependências instaladas/árvore consistente | PASS |
| Audit atual | BLOCKED |
| Homologação Supabase/Vercel/Storage/Evolution isolada | FAIL |
| 22 migrations e parity na homologação | BLOCKED |
| Drift de produção conhecido | PASS |
| RLS/grants/default privileges na homologação | BLOCKED |
| Storage negativo/positivo na homologação | BLOCKED |
| Hosted CI no artifact candidato | FAIL |
| E2E desktop/mobile/admin/RBAC | BLOCKED |
| Accessibility real | BLOCKED |
| Evolution controlada com `providerMessageId` | BLOCKED |
| Cron/auth/heartbeat | BLOCKED |
| Alerta externo recebido e deduplicado | BLOCKED |
| Backup/PITR configurado | BLOCKED |
| Backup e restore do Storage | BLOCKED |
| Restore do banco em alvo novo | BLOCKED |
| Aprovação humana de produção | BLOCKED |

## Remaining Manual Steps

1. Consultar e aprovar o custo de um Supabase `alfa-cabelos-homolog` na organização `<SUPABASE_ALFA_ORG_ID>`, região `sa-east-1`; criar somente após confirmação de custo.
2. Criar o projeto Vercel separado `alfacabelos-homolog` no time `<VERCEL_TEAM_ID>`; não reutilizar o projeto `alfacabelos`.
3. Criar branch/candidate artifact somente com autorização posterior de commit e push. Associar o projeto de homologação exclusivamente a essa branch.
4. Configurar secrets exclusivos conforme a matriz, incluindo `APP_ENV=homologation`, novo `SUPABASE_PROJECT_REF`, novo bucket, novo `CRON_SECRET` e receptor controlado de alertas.
5. Provar por IDs que database, Storage, service role, Vercel e Evolution não compartilham recursos com produção.
6. Aplicar as 22 migrations somente no Supabase novo e autorizado; conferir catálogo, RLS, grants, default privileges e advisors.
7. Executar integration/E2E/a11y no alvo isolado e obter CI verde para o SHA exato.
8. Configurar sandbox Evolution, mensagem aprovada e um único número de teste explicitamente autorizado; validar SENT, retry, DEAD, replay, heartbeat e duplicidade.
9. Enviar um alerta controlado ao receptor de homologação, repetir dentro do cooldown e confirmar `suppressed`.
10. Confirmar backups/PITR no painel/API, criar destino versionado do Storage e ensaiar ambos os restores em alvos novos.
11. Reexecutar este release gate e obter aprovação humana nomeada. Produção permanece intocada até então.
