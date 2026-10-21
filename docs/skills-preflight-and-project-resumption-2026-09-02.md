# ALFA-CABELOS — Skills preflight e retomada do projeto

Data: 2026-09-02 (America/Manaus)

Escopo: recuperação local, validações não destrutivas, skills e reavaliação de readiness

Operações remotas: nenhuma

## Repository State

- Branch: `main`, acompanhando `origin/main`.
- HEAD: `a69f237622e72d5845c9a76d612e37eff089d0bf`.
- O HEAD não mudou desde a Fase 6 documentada.
- Antes desta retomada havia 44 arquivos rastreados modificados, com 1.153 adições e 811 remoções, além de arquivos não rastreados das Fases 2–6.
- As mudanças abrangem CI, configuração, páginas/APIs, autenticação, agenda, outbox, observabilidade, Prisma, testes, runbooks e `vercel.json`.
- Esta retomada acrescentou apenas `.agents/skills/*` e este relatório. Nenhuma mudança anterior foi sobrescrita.
- Não há `AGENTS.md`, `CLAUDE.md` nem `.claude/`. `.agents/` existia vazio.
- Existem 22 migrations locais, da inicial até `20260801180000_add_operational_observability`.

## Phase Recovery

| Fase | Estado recuperado | Evidência principal |
| --- | --- | --- |
| 1 — Segurança | Implementada localmente; promoção remota permanece condicionada | `docs/security-phase-1.md`, migrations de RLS/grants e auditorias históricas |
| 2 — Performance | Implementada e validada anteriormente em PostgreSQL descartável | `docs/performance-phase-2.md`, índices e contratos paginados |
| 3 — Outbox/WhatsApp | Arquitetura implementada; fornecedor real não comprovado no estado local | `docs/notification-outbox-phase-3.md`, provider, worker e migration da outbox |
| 4 — Observabilidade | Implementada localmente; alerta externo continua sem prova | `docs/observability-phase-4.md`, health/readiness, heartbeat, métricas e replay |
| 5 — Production readiness | Executada em 2026-08-01; veredito `NOT READY FOR PRODUCTION` | `docs/production-readiness-phase-5.md` |
| 6 — Liberação de bloqueadores | **Há evidência inequívoca de execução** em 2026-08-02; parou no gate de isolamento | `docs/production-readiness-phase-6.md` |

A Fase 6 não foi concluída. Ela fez inspeções read-only, comprovou compartilhamento de recursos entre targets e interrompeu corretamente migrations, deploy, WhatsApp, restore e testes externos.

## Validation

| Verificação | Resultado atual | Observação |
| --- | --- | --- |
| `npm run lint` | PASS | Sem saída de erro; execução lenta, concluída com código 0 |
| `npx tsc --noEmit` | PASS | Código 0 |
| `npx prisma validate` | PASS | Schema válido |
| `npm test` | PASS parcial | 50 passaram; 12 integrações PostgreSQL foram `SKIP` porque o ambiente não foi provado descartável |
| `npm run check:migrations` | PASS | 22 migrations verificadas |
| `npm run check:sensitive-files` | PASS | 213 arquivos; nenhum segredo evidente |
| `git diff --check` | PASS | Sem erro de whitespace; apenas avisos LF/CRLF |
| `npm audit --audit-level=moderate` | **FAIL** | 6 vulnerabilidades altas: `browserslist`, `deepmerge-ts`, `js-yaml`, `nanoid` |
| `npm audit --omit=dev --audit-level=high` | **FAIL** | 4 vulnerabilidades altas ainda aparecem na árvore omitindo dev |
| `npm ls --all` | **FAIL** | árvore local inconsistente: pacotes extraneous e `@emnapi/runtime` ausente |
| lockfile para `@emnapi/*` | **FAIL** | consumidores aparecem no lock, mas as entradas resolvidas de `@emnapi/core/runtime` continuam ausentes |

Regressões atuais: o audit deixou de estar zerado e o problema de lockfile/instalação que derrubou o CI histórico continua observável. Nenhuma correção foi aplicada nesta execução.

## Skills Inventory

Inventário anterior: nenhuma skill canônica em `.agents/skills`.

| Skill | Classificação | Origem/decisão |
| --- | --- | --- |
| `alfa-task-routing` | ACTIVE, PROJECT-SPECIFIC | Criada para seleção mínima e limites de autorização |
| `alfa-change-verification` | ACTIVE, PROJECT-SPECIFIC | Adapta debugging, TDD proporcional, verificação e claim verification |
| `alfa-evolution-operations` | ACTIVE, PROJECT-SPECIFIC | Captura invariantes e segurança operacional da integração |
| `alfa-supabase-safety` | ACTIVE, PROJECT-SPECIFIC | Adapta práticas Supabase/Postgres ao modelo server-only do projeto |
| `alfa-release-gate` | ACTIVE, PROJECT-SPECIFIC | Adapta CI/CD, cron, observabilidade e readiness ao gate do Alfa |
| Skills externas Supabase/Postgres | CANDIDATE | Boas referências gerais; não copiadas nem instaladas no projeto |
| Skills externas Vercel de deployment/cron/observability/verification | CANDIDATE | Usadas como base de comparação; não vendorizadas |
| Skill genérica separada de TDD | REDUNDANT | Absorvida pelo fluxo de mudança para evitar roteamento excessivo |
| Skill separada de observabilidade | REDUNDANT | Runbooks e Fase 4 já contêm o conhecimento local; release/Evolution fazem o routing |

Não foi criada projeção em `.claude/skills`, pois o repositório não contém evidência de uso do Claude Code.

## Skills Gap Analysis

| Capability | Existing Skill | Gap | Recommended Action |
| --- | --- | --- | --- |
| Skill routing/discovery | nenhuma | nenhuma seleção determinística | CREATE — `alfa-task-routing` |
| Systematic debugging | nenhuma | diagnóstico e primeira fronteira quebrada não formalizados | ADAPT — `alfa-change-verification` |
| Test-driven development | nenhuma | teste de regressão não roteado | ADAPT — incorporado de forma proporcional |
| Verification before completion | docs/CI dispersos | faltava ladder e regra de skipped/unknown | CREATE — `alfa-change-verification` |
| Claim verification | relatórios históricos | risco de confundir código, local, homolog e produção | CREATE — regras de evidência nas skills |
| Production safety/security review | docs de Fase 1/5/6 | faltava gate reutilizável | ADAPT — Supabase safety + release gate |
| Database audit/Supabase/Postgres | docs e migrations | faltava roteamento e gate de ambiente | ADAPT — `alfa-supabase-safety` |
| Migrations | scripts existentes | faltava autorização/paridade/rollback no routing | KEEP scripts + ADAPT safety skill |
| Vercel production/cron | `vercel.json` e docs | faltava gate de release reutilizável | ADAPT — `alfa-release-gate` |
| Browser/E2E | Playwright/CI | faltava encaixe no fluxo de claims | KEEP testes + ADAPT verification skill |
| Observability/SRE | Fase 4 e runbooks | canal externo ainda é gap operacional, não de instrução | KEEP; não criar skill redundante |
| Evolution/WhatsApp | código e Fase 3 | faltavam regras canônicas de homologação/incidente | CREATE — `alfa-evolution-operations` |
| Instalação de pacote externo de skills | nenhuma | nenhum problema exige cópia integral | REJECT |

## Routing e cenários simulados

| Cenário | Seleção esperada | Resultado |
| --- | --- | --- |
| Bug | `alfa-change-verification` + domínio afetado | PASS — diagnóstico, regressão, fix mínimo e ladder de validação |
| Migration | `alfa-supabase-safety` → `alfa-change-verification` | PASS — ambiente, RLS/grants, rebuild, paridade e proibição de escrita remota implícita |
| Falha WhatsApp | `alfa-evolution-operations` → `alfa-change-verification` | PASS — health/outbox/worker/provider antes de replay |
| Alteração de segurança | skill de domínio → `alfa-change-verification`; release gate se readiness mudar | PASS |
| Release | `alfa-release-gate` + todos os domínios afetados | PASS — qualquer gate falho mantém `NOT READY` |

Validação estrutural: cinco frontmatters, nomes/pastas, descrições, links relativos, placeholders e padrões de secrets passaram. A busca por comandos perigosos não encontrou ocorrências. O `quick_validate.py` oficial não iniciou porque o Python local não possui `PyYAML`; foi usada validação equivalente em PowerShell, sem instalar dependências globais.

## Evolution Status

| Camada | Estado atual | Evidência |
| --- | --- | --- |
| Código/provider Evolution | IMPLEMENTED | payload compatível com Evolution, timeout, classificação, `Idempotency-Key` e `providerMessageId` |
| Outbox/worker | IMPLEMENTED | claim `SKIP LOCKED`, locks, `PENDING/PROCESSING/SENT/RETRY/DEAD`, heartbeat e métricas |
| Cron em código | CONFIGURED LOCALLY | `vercel.json` agenda `/api/internal/notifications/process` a cada 5 minutos |
| Configuração `.env` local | DISABLED/INCOMPLETE | `WHATSAPP_ENABLED=false`; URL/token/instance vazios; `CRON_SECRET` ausente |
| Testes simulados | PASS | provider e políticas passaram; integrações de banco ficaram skipped nesta retomada |
| Homologação real Evolution | UNKNOWN/NO CURRENT EVIDENCE | nenhum `providerMessageId`, target isolado, número autorizado ou log de envio atual no workspace |
| Produção | UNKNOWN | nenhuma consulta remota atual foi usada para inferir estado |

A afirmação de que a Evolution foi configurada depois da Fase 5 pode ser verdadeira em algum ambiente externo, mas não é demonstrada pelo estado local ou pelos relatórios existentes. O antigo bloqueador deve ser considerado **PARTIALLY RESOLVED**: implementação existe; prova de homologação real não.

## Production Blockers

| Blocker | Phase 5 Status | Current Status | Evidence | Next Action |
| --- | --- | --- | --- | --- |
| Dependências/audit | PASS | **STILL OPEN (regressão)** | 6 altas no audit completo; 4 com `--omit=dev` | Corrigir versões/overrides e lockfile com revisão, depois repetir todos os gates |
| Lockfile/CI install | BLOCKED na Fase 6 | **STILL OPEN** | `npm ls` falha e entradas resolvidas `@emnapi/*` faltam no lock | Sincronizar lockfile sem downgrade cego e provar `npm ci` limpo |
| Homologação isolada | BLOCKED | **STILL OPEN** | Fase 6 provou compartilhamento; nenhum artefato posterior no repo | Criar/configurar Supabase, Vercel, Storage e Evolution isolados mediante autorização/custo |
| 4 migrations remotas | FAIL | **UNKNOWN** | faltavam em 02/08; nenhuma leitura remota atual | Verificar paridade read-only no alvo correto; aplicar apenas em homologação autorizada |
| WhatsApp real | BLOCKED | **PARTIALLY RESOLVED** | código completo; local desabilitado; sem prova atual de envio | Homologar um envio controlado em sandbox isolado e capturar `providerMessageId`/duplicidade |
| Cron Vercel | BLOCKED | **PARTIALLY RESOLVED** | plano Pro foi confirmado na Fase 6; execução/heartbeat remoto não | Provar cron e autenticação no projeto de homologação |
| Alertas externos | BLOCKED | **STILL OPEN** | detecção local existe; destino/entrega não | Escolher receptor e testar alerta sanitizado em homologação |
| Backup/PITR/Storage backup | BLOCKED | **STILL OPEN** | runbook existe, mas sem inventário/restore atual | Obter evidência e executar restore em alvo novo autorizado |
| RLS/grants/Storage remoto | BLOCKED | **UNKNOWN** | evidência histórica em alvo compartilhado; sem auditoria atual | Auditar read-only o alvo correto e validar migrations em homologação |
| CI hospedado | BLOCKED | **STILL OPEN** | HEAD permanece no run histórico falho; workflow local não publicado | Após corrigir regressões, obter autorização de commit/push e CI verde |
| E2E/a11y administrativa | BLOCKED | **STILL OPEN** | testes antigos parciais; nenhum E2E atual executado | Rodar suíte completa em banco descartável e depois na homologação isolada |
| Release approval | BLOCKED | **STILL OPEN** | hard gates acima falham | Reexecutar release gate após homologação e aprovação humana |

## Recommendation

Próxima execução exata: **corrigir regressões**, começando pela árvore de dependências/lockfile e pelas vulnerabilidades altas. Não continuar a Fase 6, não iniciar homologação e não executar production readiness enquanto `npm audit`, `npm ls` e uma instalação limpa de CI não estiverem verdes.

Depois da correção local: repetir lint, TypeScript, Prisma, migrations, testes, build, sensitive-files, audits e `git diff --check` em ambiente descartável. Somente então solicitar autorização para criar/configurar a homologação isolada e retomar a Fase 6 a partir do gate de isolamento.
