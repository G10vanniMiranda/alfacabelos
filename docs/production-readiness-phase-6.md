# Fase 6 — Liberação dos Bloqueadores de Produção

Data da verificação: 2026-08-02 (America/Manaus)  
Veredito: **BLOCKED — isolamento de homologação reprovado**

## Resumo executivo

A Fase 6 não pode executar migrations, testes com efeitos externos, envio de WhatsApp, restore, cron ou validações destrutivas no ambiente remoto atual. O gate obrigatório de isolamento falhou: o projeto Vercel `alfacabelos` usa as mesmas entradas de banco, Supabase, Storage e service role nos targets `production`, `preview` e `development`. Não existe projeto Vercel de homologação do Alfa Cabelos e não existe projeto Supabase de homologação do Alfa Cabelos.

O único Supabase configurado para a aplicação é o projeto `social` (`<SUPABASE_PROD_PROJECT_REF>`). Além de não possuir marcador de homologação, ele contém buckets de outras aplicações e políticas públicas de Storage fora do escopo do Alfa Cabelos. Por isso, ele foi tratado como produção/compartilhado e nenhuma escrita foi realizada.

Foram feitas apenas inspeções de leitura. Nenhuma migration, deploy, mensagem, restore, rotação de segredo, mudança de plano, commit, push ou merge foi executado.

## Inventário inequívoco

| Recurso | Identificador | Classificação | Evidência |
|---|---|---|---|
| Supabase configurado | `<SUPABASE_PROD_PROJECT_REF>` / `social` / `sa-east-1` | produção compartilhada | `.env` aponta banco, URL e service role para esse ref; não há marcador de homologação |
| Organização Supabase | `<SUPABASE_ALFA_ORG_ID>` / `Giovanni Miranda` | organização paga | plano Pro confirmado |
| Supabase de homologação Alfa | inexistente | bloqueador | o único projeto com `homolog` pertence a outra aplicação e não pode ser reutilizado |
| Vercel Alfa | `<VERCEL_PROD_PROJECT_ID>` / `alfacabelos` | produção | deployment atual `READY`, target `production`, commit `a69f237622e72d5845c9a76d612e37eff089d0bf` |
| Vercel de homologação Alfa | inexistente | bloqueador | não há projeto separado; os targets do projeto atual compartilham configuração remota |
| GitHub | `G10vanniMiranda/alfacabelos` / `main` | repositório de produção | `HEAD` local e remoto em `a69f237622e72d5845c9a76d612e37eff089d0bf` |

## Gate de isolamento

Resultado: **FAIL**.

A API da Vercel confirmou que as mesmas entradas abaixo atingem múltiplos ambientes:

- `DATABASE_URL`: `production`, `preview` e `development`;
- `SUPABASE_SERVICE_ROLE_KEY`: `production`, `preview` e `development`;
- `SUPABASE_URL`: `production`, `preview` e `development`;
- `SUPABASE_STORAGE_BUCKET`: `production`, `preview` e `development`;
- `DIRECT_URL`: `production` e `preview`.

Os valores secretos não foram exibidos. A associação dos mesmos registros aos três targets é evidência suficiente de compartilhamento. Conforme a regra de parada da Fase 6, todas as operações remotas com escrita foram interrompidas.

## Paridade de schema e migrations

O repositório contém 22 migrations. O Supabase remoto contém 18 aplicadas e está atrasado exatamente nestas quatro:

1. `20260730120000_lock_down_future_public_privileges`;
2. `20260801140000_add_booking_query_indexes`;
3. `20260801160000_harden_notification_outbox`;
4. `20260801180000_add_operational_observability`.

O drift foi confirmado no catálogo remoto:

- `AuditLog` e `OperationalHeartbeat` não existem;
- `Booking.updatedAt` e os índices novos não existem;
- `NotificationDelivery` ainda possui o contrato antigo e não contém o estado/locking da outbox endurecida;
- não há triggers ou funções públicas esperadas pelas migrations novas;
- default privileges futuros continuam concedendo privilégios amplos a `anon`, `authenticated` e `service_role`.

Não existe homologação Alfa para aplicar e validar essas migrations. Nenhuma migration foi aplicada em produção.

## CI real

A única execução do GitHub Actions encontrada foi o run `30584025465`, disparado por push em `main` no commit `a69f237622e72d5845c9a76d612e37eff089d0bf`, em 2026-07-30. Resultado: **FAIL**.

O job `quality-and-security` parou no passo `Install locked dependencies`. O `npm ci` informou que `package.json` e `package-lock.json` estavam fora de sincronia, com ausência de `@emnapi/runtime@1.11.3` e `@emnapi/core@1.11.3` no lockfile. Todos os gates posteriores foram ignorados.

O workflow local possui validações adicionais das Fases 2–5, mas está sem commit e sem push; portanto ainda não existe execução remota que as comprove. Não houve rerun automático.

## Vercel e cron

O plano da equipe Vercel foi confirmado como **Pro**, compatível com cron a cada cinco minutos. Isso resolve apenas a compatibilidade comercial da expressão `*/5 * * * *`.

A execução real do cron, autenticação por `CRON_SECRET`, logs e heartbeat não puderam ser validados: o código/configuração atual não está publicado em ambiente isolado e o projeto existente compartilha os recursos de produção.

## Storage, RLS e segurança

No projeto Supabase compartilhado:

- `barber` é público e contém objetos da aplicação;
- `box` e `pdv` são públicos e possuem políticas `PUBLIC` de `SELECT`, `INSERT`, `UPDATE` e `DELETE` limitadas apenas pelo bucket;
- `reviews-photos` também existe;
- as tabelas atuais da aplicação possuem RLS habilitado e nenhuma policy pública, coerente com acesso server-side;
- os default privileges ainda não receberam o hardening da migration pendente.

As policies de `box` e `pdv` parecem pertencer a outras aplicações. Elas não foram modificadas. A existência desses recursos reforça que o projeto `social` não é uma homologação isolada do Alfa Cabelos.

## Itens que continuam sem prova segura

- envio WhatsApp real para número de teste autorizado: URL, token e número autorizado não foram fornecidos;
- canal externo de alertas e entrega real: a aplicação detecta/loga alertas, mas não possui destino externo configurado;
- inventário real de backups, retenção e PITR do projeto: plano Pro não substitui evidência do painel/API;
- restore em projeto novo e isolado: não executado por envolver criação/custo e configuração manual de Storage/segredos;
- CRUD administrativo completo, acessibilidade e jornada E2E na homologação real;
- build e fail-fast com a matriz definitiva de variáveis do ambiente isolado;
- prova de cron, heartbeat, retry/replay e observabilidade em execução remota.

## Autorizações e insumos mínimos para continuar

1. Confirmar a criação de um Supabase `alfa-cabelos-homolog` na organização `Giovanni Miranda` (`<SUPABASE_ALFA_ORG_ID>`), região `sa-east-1`. Antes da criação será consultado e apresentado o custo.
2. Autorizar a criação de um projeto Vercel separado `alfacabelos-homolog`, com variáveis próprias e sem compartilhar banco, Storage ou segredos de produção.
3. Autorizar explicitamente branch, commit e push das mudanças locais para que o CI atualizado e o deployment de homologação possam existir. Não será feito merge automático.
4. Fornecer ou configurar credenciais de sandbox WhatsApp e declarar o único número autorizado para o teste.
5. Definir o destino externo de alertas (por exemplo, webhook operacional) e quem deve recebê-los.
6. Disponibilizar evidência de backups/PITR pelo painel ou acesso de gerenciamento capaz de listar backups; um restore será feito somente em projeto novo e vazio, após aprovação do custo.

## Decisão de go-live

**NOT READY / BLOCKED.** O bloqueador raiz não é uma falha de migration local, mas a ausência de homologação isolada. Depois da criação dos dois recursos isolados, a ordem segura é: configurar segredos exclusivos, aplicar as 22 migrations na homologação, validar paridade e segurança, publicar a branch, obter CI verde, executar E2E/cron/WhatsApp/alertas/backup-restore e então reavaliar o gate. Produção permanece intocada até aprovação explícita posterior.
