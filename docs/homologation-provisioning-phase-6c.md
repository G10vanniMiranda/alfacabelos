# Fase 6C — Proposta de homologação isolada

Data: 2026-09-04 (America/Manaus)

Estado: **PLANNING COMPLETE — NO RESOURCES PROVISIONED**

Este documento usa a Fase 6B como baseline e adiciona somente evidência read-only atual, investigação da CI e preparação local dos guards. Nenhuma criação, migration, configuração de secret, mensagem, deploy ou outra mutação remota foi executada.

## Preflight

| Claim | Classificação | Evidência atual | Limite |
| --- | --- | --- | --- |
| Repositório e branch de produção | EVIDENCE | GitHub repo ID `1152409992`, `G10vanniMiranda/alfacabelos`, default branch `main` | nenhuma branch de homologação criada |
| HEAD publicado | EVIDENCE | `a69f237622e72d5845c9a76d612e37eff089d0bf` no GitHub, Git local e deployment Vercel | worktree local contém mudanças não publicadas |
| CI atual | EVIDENCE | run `30584025465`, job `91011017695`, `failure` em `Install locked dependencies` | não houve novo run porque push é proibido |
| Vercel produção | EVIDENCE | projeto e deployment consultados por ID | nenhuma configuração alterada |
| Vercel homologação ALFA | EVIDENCE | não aparece entre os projetos atuais do time | nome/URL ainda dependem de disponibilidade no momento da criação |
| Supabase produção | EVIDENCE | projeto consultado diretamente pelo ref conhecido | listagem global do conector está incompleta entre organizações |
| Supabase homologação ALFA | NOT VERIFIED | a Fase 6B não encontrou o projeto; a listagem desta sessão omitiu a organização ALFA embora o lookup direto funcione | repetir inventário na organização correta imediatamente antes da criação |
| Produção em 18/22 migrations | NOT VERIFIED nesta wave | evidência read-only da Fase 6B; não foi repetida por não haver nova auditoria geral | continua sendo baseline, não autorização de escrita |

O `list_projects` Supabase desta sessão retornou apenas a organização `<SUPABASE_OTHER_ORG_ID>` (`<outra organização>`) e dois projetos de outra aplicação. O lookup direto ainda confirma a organização e o projeto ALFA. Essa inconsistência impede tratar a ausência de homologação como prova atual absoluta; nenhum recurso de outras aplicações é candidato ao ALFA.

## Current Production IDs

| Recurso | Identificador | Estado |
| --- | --- | --- |
| GitHub repository | `1152409992` / `G10vanniMiranda/alfacabelos` | público, branch padrão `main` |
| GitHub HEAD | `a69f237622e72d5845c9a76d612e37eff089d0bf` | commit `update` |
| GitHub CI | run `30584025465`; job `91011017695` | failure |
| Vercel team | `<VERCEL_TEAM_ID>` | Pro |
| Vercel project | `<VERCEL_PROD_PROJECT_ID>` (`alfacabelos`) | Next.js, Node 24.x |
| Vercel deployment | `dpl_CLefDsSDMwdqtyirhqDZvrTP7i2U` | READY, target production, região `iad1` |
| Vercel domain | `alfacabelos.vercel.app` | produção |
| Supabase organization | `<SUPABASE_ALFA_ORG_ID>` (`Giovanni Miranda`) | Pro |
| Supabase project | `<SUPABASE_PROD_PROJECT_REF>` (`social`) | ACTIVE_HEALTHY |
| Supabase database | `db.<SUPABASE_PROD_PROJECT_REF>.supabase.co` | PostgreSQL 15.8.1.100, `sa-east-1` |
| Supabase branches | projeto `<SUPABASE_PROD_PROJECT_REF>` | zero branches |
| Storage ALFA conhecido | projeto acima, bucket `barber` | produção; não reutilizar |

Nenhum valor de chave, senha, token, connection string completa ou PII foi registrado.

## Homologation Architecture

```text
GitHub: branch homologation (futura)
  ├─ CI com PostgreSQL efêmero
  └─ Vercel project alfacabelos-homolog
       ├─ production target do projeto de homologação
       ├─ URL estável exclusiva
       ├─ cron exclusivo
       └─ secrets exclusivos
            ├─ Supabase project alfacabelos-homolog
            │    ├─ PostgreSQL próprio
            │    └─ bucket barber-homolog
            ├─ Evolution instance alfacabelos-homolog
            └─ canal de alerta de homologação
```

O target `production` do projeto Vercel de homologação significa somente o ambiente estável daquele projeto separado. Ele nunca pode conter IDs ou secrets do projeto ALFA de produção.

## Supabase Proposal

- organização proposta: `<SUPABASE_ALFA_ORG_ID>`, após reconfirmar acesso e inventário;
- nome proposto: `alfacabelos-homolog`;
- região: `sa-east-1`, igual à produção, para reduzir diferenças de latência/região;
- compute inicial: menor tamanho pago suportado pela organização, sem add-ons;
- Postgres: versão GA oferecida na criação. Registrar a versão exata; não presumir PG15;
- banco, API URL, publishable key, secret/service-role key e Storage próprios;
- sem import, clone, branch ou restore de produção;
- sem PII e sem reutilização de keys.

Novos projetos Supabase podem não expor tabelas novas automaticamente pela Data API. Isso não altera o modelo atual: Prisma opera server-side, `anon`/`authenticated` continuam sem acesso às tabelas da aplicação e RLS permanece habilitado. O changelog atual também informa que versões explícitas de extensions podem ser ignoradas; as 22 migrations não contêm `CREATE/ALTER EXTENSION`, portanto não há impacto identificado.

## Vercel Proposal

Escolha: **projeto Vercel separado** `alfacabelos-homolog`.

| Critério | Projeto separado | Preview/custom environment no projeto de produção |
| --- | --- | --- |
| Secrets | namespace de projeto independente | escopo pode ser separado, mas permanece no mesmo projeto |
| Cron | roda no production deployment do projeto de homologação | cron do `vercel.json` é ligado ao production deployment do projeto; Preview não prova cron isolado |
| URL | alias estável próprio | Preview pode ter URL de branch; custom environment também pode ter domínio |
| Rollback/logs | histórico operacional separado | compartilha projeto, permissões e parte da configuração |
| Erro humano | menor chance de fallback para secrets de produção | maior risco de variável Preview genérica ou branch mal associada |
| Custo | sem tarifa fixa adicional de projeto documentada; gera consumo | custom environment está incluído no Pro |

Configuração proposta:

- team `<VERCEL_TEAM_ID>`;
- repository `G10vanniMiranda/alfacabelos`;
- production branch futura `homologation`;
- framework Next.js;
- Node 24.x, alinhado à produção Vercel atual;
- install `npm ci` e build `npm run build`;
- cron `*/5 * * * *` para `/api/internal/notifications/process`;
- URL proposta `alfacabelos-homolog.vercel.app`, sujeita à disponibilidade;
- sem domínio customizado nesta primeira etapa.

Vercel documenta projetos ilimitados no Pro, até 60 projetos conectados ao mesmo repositório e cobrança por consumo. Cron invoca a URL do production deployment do projeto. Referências: [limits](https://vercel.com/docs/limits), [environments](https://vercel.com/docs/deployments/environments) e [cron jobs](https://vercel.com/docs/cron-jobs).

## Evolution Proposal

- instância proposta: `alfacabelos-homolog`;
- token próprio e, se possível, conta/sessão própria;
- `WHATSAPP_ENABLED=false` durante migrations, seed, E2E e smoke tests comuns;
- um único número de teste somente após autorização explícita futura;
- número real autorizado fornecido por secret, nunca persistido no seed;
- allowlist no provedor quando suportada;
- mensagem aprovada e limite de um envio inicial;
- capturar outbox ID, categoria, `providerMessageId`, heartbeat e contagem de duplicatas sem PII;
- não prometer exactly-once: idempotency reduz risco, mas depende do provedor.

Se a instalação Evolution não suportar múltiplas instâncias realmente isoladas, a decisão volta ao gate humano; não se reutiliza a instância de produção por conveniência.

## Environment Contract

| Variable | Homologation Source | Secret | Required |
| --- | --- | ---: | ---: |
| `APP_ENV` | literal `homologation` | não | sim |
| `HOMOLOGATION_TARGET_CONFIRMED` | operador, somente após conferir IDs | não | sim para comandos mutáveis |
| `DATABASE_URL` | pooler do novo Supabase | sim | sim |
| `DIRECT_URL` | conexão direta do novo Supabase | sim | sim |
| `APP_URL` | URL estável do novo projeto Vercel | não | sim |
| `NEXT_PUBLIC_APP_URL` | mesma URL pública de homologação | não | sim |
| `SUPABASE_URL` | API URL do novo projeto | não | sim |
| `SUPABASE_PROJECT_REF` | ref do novo projeto | não | sim |
| `SUPABASE_PUBLISHABLE_KEY` | key própria do novo projeto; atualmente não consumida pelo app | não | não |
| `SUPABASE_SERVICE_ROLE_KEY` | secret/service-role key do novo projeto | sim | sim |
| `SUPABASE_STORAGE_BUCKET` | literal `barber-homolog` | não | sim |
| `PRODUCTION_SUPABASE_PROJECT_REF` | baseline não secreta `<SUPABASE_PROD_PROJECT_REF>` | não | sim |
| `PRODUCTION_APP_HOST` | hostname público de produção | não | sim |
| `PRODUCTION_STORAGE_BUCKET` | nome do bucket de produção | não | sim |
| `WHATSAPP_ENABLED` | `false` inicialmente | não | sim |
| `WHATSAPP_PROVIDER` | tipo do provider homolog | não | se habilitado |
| `WHATSAPP_API_URL` | endpoint da instância homolog | restrito | se habilitado |
| `WHATSAPP_API_TOKEN` | token exclusivo | sim | se habilitado |
| `WHATSAPP_INSTANCE_ID` | ID exclusivo homolog | restrito | se habilitado |
| `PRODUCTION_EVOLUTION_INSTANCE_ID` | baseline não secreta/restrita | restrito | se habilitado |
| `WHATSAPP_OWNER_PHONE` | número de teste autorizado | PII/secret | somente teste externo autorizado |
| `WHATSAPP_WEBHOOK_SECRET` | secret exclusivo | sim | conforme integração |
| `CRON_SECRET` | gerado exclusivamente para homologação, mínimo 16 chars | sim | sim |
| `ALERT_WEBHOOK_URL` | endpoint/canal exclusivo de homologação | sim | sim |
| `ALERT_WEBHOOK_TOKEN` | Bearer exclusivo | sim | conforme receptor |
| `ALERT_COOLDOWN_SECONDS` | `900` inicialmente | não | não |
| `ALERT_WEBHOOK_TIMEOUT_MS` | `5000` inicialmente | não | não |
| `ALERT_*` thresholds | defaults versionados e revisados | não | não |
| `APP_VERSION` | SHA do candidate artifact | não | recomendado |
| `HOMOLOGATION_EXTERNAL_TESTS` | operador após autorização específica | não | somente testes externos |
| `RUN_DATABASE_TESTS` | pipeline homolog autorizado | não | testes PostgreSQL |
| `ALLOW_DESTRUCTIVE_TESTS` | pipeline homolog autorizado | não | fixtures/cleanup autorizados |

Secrets devem existir apenas no projeto Vercel de homologação e nunca em variáveis `NEXT_PUBLIC_*`, GitHub, logs ou arquivos versionados.

## Isolation Guards

O runtime agora exige uma baseline explícita em homologação e retorna `not_ready`/HTTP 503 se a configuração estiver incompleta ou reutilizar produção.

| Violação | Issue code |
| --- | --- |
| baseline de produção ausente | `production_identity_baseline` |
| mesmo project ref Supabase | `production_supabase_reference` |
| `DATABASE_URL` ou `DIRECT_URL` contém o ref de produção | `production_database` |
| mesmo bucket | `production_storage` |
| mesmo hostname da aplicação | `production_application` |
| baseline Evolution ausente quando habilitada | `production_evolution_baseline` |
| mesma instância Evolution | `production_evolution_instance` |

Também foi criado `npm run homologation:guard`. Ele exige `APP_ENV=homologation`, `HOMOLOGATION_TARGET_CONFIRMED=true` e toda a configuração crítica saudável. O comando deve anteceder cada migration, seed, integração PostgreSQL, teste Storage ou ação Evolution. O teste contra o `.env` atual terminou em `HOMOLOGATION_GUARD_BLOCKED`, sem mostrar secrets.

Limite conhecido: um operador ainda poderia ignorar o wrapper e executar ferramentas diretamente. Permissões do provider, revisão humana e execução por pipeline são controles obrigatórios adicionais; uma variável booleana isolada nunca prova segurança.

## Synthetic Data Strategy

Não executar o `prisma/seed.ts` atual em homologação remota antes de adaptá-lo: ele contém apenas barbeiro, serviços, bloqueio e galeria e não representa todos os cenários exigidos.

O futuro seed homologado deve ser idempotente, protegido por `homologation:guard` e criar somente:

| Entidade | Dados sintéticos |
| --- | --- |
| Admin | `admin.qa@example.invalid`; senha injetada por secret |
| Cliente | nomes `Cliente QA`; e-mails `example.invalid`; telefone não roteável e WhatsApp desabilitado |
| Barbeiros | pelo menos dois profissionais QA |
| Serviços | durações 20, 30, 45 e 50 minutos; preço fictício |
| Horários | semana normal, almoço e dia sem expediente |
| Bookings | PENDENTE, CONFIRMADO, CANCELADO, conflito e série |
| Bloqueios | almoço, manutenção e sobreposição negativa |
| NotificationDelivery | PENDING, RETRY e DEAD; nenhum SENT externo criado pelo seed |
| AuditLog/heartbeat | cenários mínimos para operations e alertas |
| Galeria | fixtures SVG/imagem locais já versionadas; nenhum objeto de cliente |

O número real autorizado para a única prova Evolution não faz parte do seed. Reset/cleanup deve filtrar IDs/prefixos QA e somente rodar após o guard no projeto homolog.

## Migration Strategy

```text
novo projeto vazio
→ confirmar IDs e homologation:guard
→ validar Prisma e 22 arquivos
→ prisma migrate deploy com DIRECT_URL homolog
→ conferir _prisma_migrations = 22
→ adaptar/executar seed sintético
→ verificar tabelas, colunas, índices, triggers e constraints
→ verificar RLS, grants e default privileges
→ criar/testar bucket homolog
→ deploy do projeto Vercel homolog
→ /api/ready = 200
→ smoke, integrations, E2E e a11y
```

Não usar dump/schema de produção como baseline. A prova exigida é reconstrução completa a partir de zero. Registrar a versão Postgres fornecida; se for PG17, alinhar posteriormente o serviço PostgreSQL da CI após validação isolada.

## Storage Strategy

- bucket proposto: `barber-homolog` no novo project ref;
- público somente para leitura das fixtures sintéticas, pois o app atual gera URLs públicas;
- nenhum grant/policy de escrita para `anon` ou `authenticated`;
- upload/delete exclusivamente pelo backend com secret/service-role homolog;
- prefixo `galeria/` e fixtures exclusivamente sintéticas;
- limite de 5 MB para imagens e limite efetivamente suportado pelo fluxo atual para vídeos;
- testes futuros: MIME/extensão, magic bytes, vazio, corrompido, tamanho, dupla extensão, SVG, traversal, origem/bucket, upload, leitura e delete;
- inventário antes/depois e cleanup limitado ao prefixo/IDs do run;
- nenhuma cópia de `barber`, `box`, `pdv` ou `reviews-photos` de produção.

## CI Root Cause

O log remoto prova:

- runner Ubuntu 24.04;
- Node 20.19.0 e npm 10.8.2 instalados corretamente;
- cache npm inexistente, mas isso não causou a falha;
- PostgreSQL 16 ficou healthy;
- `npm ci` encerrou com `EUSAGE` porque o lockfile do SHA não continha `@emnapi/runtime@1.11.3` e `@emnapi/core@1.11.3`;
- Prisma e todos os gates seguintes nunca foram executados.

O lockfile local não publicado agora contém ambas as entradas e a raiz registra as optional dependencies necessárias ao grafo Sharp/WASM. `npm ci --dry-run --ignore-scripts --no-audit` passou com npm 11.6.2 e, mais importante, com a mesma versão npm 10.8.2 da CI. Portanto, a causa do `EUSAGE` está corrigida no artefato local, mas a CI continua **NOT VERIFIED** até um futuro push autorizado gerar run verde no SHA candidato. Não é necessário outro ajuste local nesta Fase 6C.

## Local Changes

- `lib/observability/health.ts`: baseline e rejeição dos identificadores de produção em homologação;
- `tests/observability.test.ts`: regressões para baseline ausente e reuso de Supabase, banco, bucket, app e Evolution;
- `.env.example`: contrato das baselines e confirmação do alvo;
- `scripts/assert-isolated-homologation.ts`: gate CLI sanitizado;
- `package.json`: comando `homologation:guard`;
- este documento de proposta.

## Verification

| Gate | Resultado |
| --- | --- |
| Guard de homologação contra `.env` atual | PASS negativo: bloqueou com exit 1 e somente issue codes sanitizados |
| Observabilidade/isolation guards | PASS: 12/12 |
| Suite local | PASS parcial: 56 PASS, 12 PostgreSQL SKIP, 0 FAIL |
| ESLint | PASS |
| TypeScript | PASS |
| Prisma schema | PASS |
| Migrations | PASS: 22 |
| Sensitive files | PASS: 233 arquivos, nenhum segredo evidente |
| Build | PASS: 34 páginas |
| Lockfile com npm 11.6.2 | PASS: `npm ci --dry-run --ignore-scripts --no-audit` |
| Lockfile com npm 10.8.2 da CI | PASS: mesmo dry-run com versão exata |
| Hosted CI do candidato | NOT VERIFIED: nenhum push/run autorizado |
| PostgreSQL/E2E homolog | NOT RUN: alvo ainda não existe |

## PROVISIONING PROPOSAL

| Resource | Provider | Proposed Name | Region | Purpose | Estimated Impact |
| --- | --- | --- | --- | --- | --- |
| PostgreSQL/API/Auth | Supabase | `alfacabelos-homolog` | `sa-east-1` | banco vazio e APIs próprias | projeto adicional, compute cobrado por hora |
| Storage | Supabase | `barber-homolog` | acompanha projeto | mídia sintética e testes negativos | uso agregado de Storage/egress |
| Aplicação | Vercel | `alfacabelos-homolog` | functions inicialmente conforme plataforma; observar distância ao DB | runtime, URL e cron isolados | sem tarifa fixa de projeto documentada; consumo do time Pro |
| Git branch | GitHub | `homologation` | N/A | candidate artifact estável | novo fluxo CI/deploy; sem custo direto conhecido |
| WhatsApp | Evolution | `alfacabelos-homolog` | próximo/compatível com runtime quando suportado | uma instância e número de teste | custo/capacidade dependem do provedor atual |
| Alert channel | receptor a escolher | `alfa-homolog` | HTTPS público | provar entrega e cooldown | pode haver custo do receptor |

Sequência após futura autorização explícita:

1. reconfirmar a organização Supabase correta, inventário, nome disponível e cotação exata;
2. criar somente o projeto Supabase homolog em `sa-east-1` e registrar ref/versão;
3. criar bucket `barber-homolog` e controles mínimos, ainda sem fixtures;
4. criar instância Evolution homolog ou voltar ao gate se isolamento não for suportado;
5. criar projeto Vercel separado e associar a futura branch `homologation`;
6. gerar/configurar secrets exclusivos e baselines não secretas;
7. executar `homologation:guard` e registrar PASS;
8. aplicar as 22 migrations no banco vazio e verificar catálogo/RLS/grants;
9. adaptar e executar seed sintético;
10. fazer deploy homolog, validar `/api/ready`, cron e alertas;
11. executar integrations, E2E, a11y, Storage e uma prova Evolution autorizada;
12. atualizar o release gate sem promover produção.

## Costs / External Decisions

- A organização Supabase ALFA é Pro. Documentação atual informa que cada projeto possui compute dedicado e projetos adicionais no tamanho Micro começam em aproximadamente **US$ 10/mês**, cobrados por hora. Os US$ 10 de compute credits são por organização e normalmente cobrem apenas um Micro; confirmar a fatura/uso existente e obter cotação específica antes da criação. Referências: [compute usage](https://supabase.com/docs/guides/platform/manage-your-usage/compute) e [billing FAQ](https://supabase.com/docs/guides/platform/billing-faq).
- Storage Supabase é agregado na organização: Pro inclui quota e cobra overage. O pequeno seed deve ser irrelevante, mas upload tests e retenção precisam de limites.
- O time Vercel já é Pro. Projetos são ilimitados e a criação não tem tarifa fixa adicional documentada; build, Functions, transferência e demais consumos usam o crédito do plano e podem gerar pay-as-you-go.
- Evolution: capacidade de instância separada, limite de números e custo são **UNKNOWN** e exigem decisão do operador/provedor.
- Alert receiver: provider, retenção, acesso e custo são **UNKNOWN**.
- Não incluir inicialmente domínio customizado, PITR, IPv4 dedicado ou add-ons.

## Risks

1. `list_projects` Supabase não mostrou a organização ALFA nesta sessão; criar sem corrigir/reconfirmar esse contexto pode atingir a organização errada.
2. Projeto Supabase novo pode usar PG17 enquanto produção usa PG15 e CI usa PG16; registrar e testar diferenças antes de alinhar CI.
3. Mesmo projeto Vercel com Preview permitiria fallback de secrets e não provaria o cron; por isso foi rejeitado.
4. Bucket público expõe leitura dos objetos; somente fixtures sintéticas podem ser armazenadas.
5. O seed atual é incompleto e não deve rodar remotamente até receber guard e cenários sintéticos completos.
6. Guard de aplicação não substitui IAM/provider nem impede um operador de executar CLI diretamente.
7. Um Evolution compartilhado pode entregar a destinatários reais por erro; instância/allowlist separadas são obrigatórias.
8. Correção local da CI ainda não é evidência de hosted CI verde.

## Human Gate

Nenhum recurso será criado nesta execução. A autorização futura precisa nomear explicitamente:

- organização Supabase `<SUPABASE_ALFA_ORG_ID>` e aceitação do custo cotado;
- criação do projeto `alfacabelos-homolog` em `sa-east-1`;
- criação do projeto Vercel `alfacabelos-homolog` no time `<VERCEL_TEAM_ID>`;
- estratégia/instância Evolution e número de teste autorizado;
- receptor de alerta;
- autorização separada posterior para branch/commit/push/deploy e testes externos.

**AWAITING HUMAN PROVISIONING APPROVAL**
