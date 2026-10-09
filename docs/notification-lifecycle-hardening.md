# Notification lifecycle hardening

Status: implementado localmente na branch `hardening/notification-lifecycle` (base `40b01cf`). Sem commit, sem deploy.

## Problema

A elegibilidade do worker (`claim-policy.ts`) é operacional: `PENDING/RETRY`, `eligibleAt <= now`, backoff vencido, tentativas restantes e lock livre. Ela não diz se a mensagem ainda é verdadeira ou útil. Com `WHATSAPP_ENABLED` ausente, o cron continuava enfileirando lembretes, e os eventos transacionais se acumulavam. Na ativação, o worker enviaria tudo, inclusive lembretes de horários passados e links de recuperação vencidos.

## Resultados da validação

A política (`lib/notifications/validity-policy.ts`) nunca é fail-open. Só `VALID` chega ao provider.

| Resultado | Significado | Tratamento no worker | `errorCategory` |
|---|---|---|---|
| `VALID` | a notificação ainda é verdadeira e útil, até `validUntil` | envia | — |
| `INVALID` (`EXPIRED`, `CANCELED`, `INVALID_REFERENCE`) | comprovadamente inválida | `DEAD`, `eligibleAt=NULL`, sem provider | `lifecycle_expired`, `lifecycle_canceled`, `lifecycle_invalid_reference` |
| `UNSUPPORTED_EVENT` | evento sem política explícita | `DEAD`, sem provider | `lifecycle_unsupported_event` |
| `TEMPORARILY_UNVERIFIABLE` | as referências (agendamento ou token) não puderam ser lidas: conexão, timeout, pool ou erro inesperado do validador | volta para `RETRY` com backoff, sem provider | `lifecycle_unverifiable` |

A função pura `evaluateNotificationValidity` só produz `VALID`, `INVALID` e `UNSUPPORTED_EVENT`. `checkNotificationValidity` converte uma falha de leitura das referências em `TEMPORARILY_UNVERIFIABLE`; ela nunca lança exceção e nunca confunde "não consegui verificar" com "verifiquei e é inválida". O worker faz o mesmo com qualquer exceção do validador.

### Falha transitória: retry, prazo e exaustão

Quando o resultado é `TEMPORARILY_UNVERIFIABLE`, o worker chama `deferUnverifiableDelivery`:

1. O provider não é chamado.
2. A tentativa reservada no claim (`attempts + 1`) é consumida. Por isso o laço é limitado por `NOTIFICATION_MAX_ATTEMPTS` (padrão 8).
3. O `nextRetryAt` usa o mesmo backoff exponencial do provider (30s × 2^(n−1), teto de 1h, jitter).
4. O prazo máximo é respeitado sem acessar o banco. `notificationValidityUpperBound` deriva da própria linha da outbox o último instante em que ela poderia ser válida:
   - `PASSWORD_RESET`: `createdAt + 30 min` (o token é criado antes da linha, na mesma transação);
   - avisos de criação: `createdAt + 6h`;
   - `BOOKING_REMINDER`: início gravado na chave − antecedência mínima;
   - `BOOKING_RESCHEDULED`: início gravado na chave;
   - `BOOKING_CANCELLED`: sem limite derivável; vale apenas o limite de tentativas.
5. Se o próximo retry cair em ou depois desse limite → `DEAD` com `lifecycle_expired` e `unverifiable_until_expiry:<motivo>`.
6. Se as tentativas acabaram → `DEAD` com `lifecycle_unverifiable_exhausted`.
7. Caso contrário → `RETRY`, preservando `eligibleAt`, com `lastError = "Notification validity temporarily unverifiable: <motivo>"`.
8. Na próxima tentativa, a validade é recalculada do zero. Se a notificação expirou durante a indisponibilidade, ela vira `INVALID` e `DEAD`, sem envio.

Todas as transições usam a guarda de lease (`status = PROCESSING AND lockedBy = <worker>`). Se outro worker recuperou o lock, a escrita não afeta nada.

Se o banco cair também durante a escrita da transição, a exceção interrompe o lote e a linha fica em `PROCESSING`. A recuperação de lock vencido (5 min) a devolve para `RETRY`, como antes. Comportamento pré-existente, não alterado.

Falha transitória **do provider** (já existente): se o backoff cairia depois de `validUntil`, a linha vira `DEAD` com `retry_after_expiry:<categoria>` em vez de `RETRY`.

## Política definitiva de expiração

Todos os timestamps são instantes UTC (`timestamp without time zone` gravado em UTC pelo Prisma). As comparações usam milissegundos absolutos. Nenhuma regra usa o `createdAt` da notificação como substituto do horário do atendimento.

| Evento | Válido somente se | Válido até |
|---|---|---|
| `PASSWORD_RESET` | a chave é `password-reset:<sha256>` e o token existe, não foi usado e não expirou. Qualquer outra situação → `INVALID`. | `expiresAt` do token |
| `BOOKING_REMINDER` | o agendamento existe, não está `CANCELADO/CONCLUIDO/AUSENTE` e o início ainda não passou. O início atual também precisa ser igual ao início gravado na chave; se for diferente, houve reagendamento. Ainda é preciso faltar pelo menos `NOTIFICATION_REMINDER_MIN_LEAD_MINUTES` (padrão 60, limitado a `lead − window`). | início − antecedência mínima |
| `BOOKING_CREATED_BY_STAFF` | o agendamento existe e está ativo, o início é futuro e o aviso tem **menos de 6h**. Se a mensagem traz link de confirmação, o token também precisa estar ativo: não usado, não vencido e agendamento `PENDENTE`. | menor entre início, `createdAt + 6h` e expiração do token |
| `BOOKING_CREATED_BY_CLIENT` (aviso ao dono) | o agendamento existe e está ativo, o início é futuro e o aviso tem **menos de 6h** | menor entre início e `createdAt + 6h` |
| `BOOKING_RESCHEDULED` | o agendamento existe e está ativo, o início é futuro e o início na chave é igual ao atual. Se não for, houve um novo reagendamento. | início |
| `BOOKING_CANCELLED` | o agendamento está `CANCELADO` e o horário original ainda não passou | início original |
| outro evento | nunca (`UNSUPPORTED_EVENT`) | — |

A janela de 6h dos avisos de criação (`BOOKING_CREATED_NOTICE_MAX_AGE_MS`) é independente do **TTL de 48h do link de confirmação**, que não foi alterado.

### Inconsistências conhecidas em cancelamento e reagendamento (política mantida)

- **Sem limite de idade:** `BOOKING_CANCELLED` e `BOOKING_RESCHEDULED` continuam válidos até o horário do atendimento. Um aviso de cancelamento de um horário marcado para daqui a 10 dias pode ser enviado dias depois do cancelamento. Os avisos de criação, ao contrário, expiram em 6h.
- **`BOOKING_CANCELLED` exige o estado atual `CANCELADO`:** se o agendamento for reativado depois (não há fluxo para isso hoje), o aviso vira `INVALID_REFERENCE`.
- **Sem limite derivável para `BOOKING_CANCELLED` sob falha transitória:** a chave não carrega o horário, então apenas o limite de tentativas restringe o retry.
- **Chave de `BOOKING_RESCHEDULED`:** usa o início do agendamento no momento do enqueue. `buildBookingNotificationIntent` aceita `updatedAt`, mas nenhum chamador o envia. Se algum chamador passar a enviá-lo, a política classificará a notificação como `booking_rescheduled_again` (`INVALID`, fail-closed).

Recomendação para revisão futura: aplicar a cancelamento e reagendamento uma idade máxima explícita, como nos avisos de criação.

## Outras mudanças no ciclo

- **Replay (`replay.ts`):** revalida dentro da transação serializável. Inválida ou sem política → `no_longer_valid`. Não verificável → `temporarily_unverifiable`. Em ambos os casos a rota existente responde 409, a linha não muda e nenhuma auditoria é registrada.
- **Geração de lembretes (`booking-intents.ts`):** `enqueueDueBookingReminders` não cria nada enquanto `WHATSAPP_ENABLED !== "true"`. Lead e janela vêm de `reminderSchedule()`, compartilhado com a política.
- **Worker desligado:** sem mudança: `claimed=0`, `sent=0`, `expired=0`, nenhuma escrita na outbox.
- **Guard estático (`scripts/check-migrations.mjs`):** falha se `service.ts` deixar de chamar `validate(item, …)` antes de `send({…})`.
- **`WorkerSummary`:** ganhou `expired` (aposentadas pela política). Deferimentos por falha transitória contam em `retry`.

Sem impacto de schema: nenhuma migration nova.

### Garantias preservadas

- Claim com `FOR UPDATE SKIP LOCKED` e predicado canônico inalterados.
- Toda transição posterior ao claim exige `status=PROCESSING AND lockedBy=<worker>`.
- `DEAD` só volta à fila por replay explícito, auditado e revalidado.
- Idempotência por `idempotencyKey` inalterada.

## Procedimento de quarentena de produção (NÃO EXECUTADO)

Pré-condições:
- `WHATSAPP_ENABLED` ausente. Com isso o worker não faz claim, e não há concorrência com ele.
- O operador autorizou explicitamente a escrita.
- Não há deploy em andamento.

### 1. Classificação read-only

Rodar com o operador e guardar a lista de `id` fora de relatórios. A consulta não retorna PII nem conteúdo.

```sql
BEGIN READ ONLY;
WITH now_utc AS (SELECT (now() AT TIME ZONE 'UTC') AS ts),
c AS (
  SELECT nd."id", nd."event",
    CASE
      WHEN nd."event" = 'PASSWORD_RESET' THEN
        CASE WHEN substring(nd."idempotencyKey" from '^password-reset:([0-9a-f]{64})$') IS NULL OR prt."id" IS NULL THEN 'INVALID_REFERENCE'
             WHEN prt."usedAt" IS NOT NULL OR prt."expiresAt" <= n.ts THEN 'EXPIRED'
             ELSE 'VALID_NOW' END
      WHEN nd."event" NOT IN ('BOOKING_REMINDER','BOOKING_RESCHEDULED','BOOKING_CANCELLED','BOOKING_CREATED_BY_STAFF','BOOKING_CREATED_BY_CLIENT') THEN 'UNSUPPORTED_EVENT'
      WHEN b."id" IS NULL THEN 'INVALID_REFERENCE'
      WHEN nd."event" = 'BOOKING_CANCELLED' THEN
        CASE WHEN b."status" <> 'CANCELADO' THEN 'INVALID_REFERENCE'
             WHEN b."dateTimeStart" <= n.ts THEN 'EXPIRED' ELSE 'VALID_NOW' END
      WHEN b."status" = 'CANCELADO' THEN 'CANCELED'
      WHEN b."status" IN ('CONCLUIDO', 'AUSENTE') OR b."dateTimeStart" <= n.ts THEN 'EXPIRED'
      WHEN nd."event" = 'BOOKING_REMINDER' THEN
        CASE WHEN to_char(b."dateTimeStart", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
                  IS DISTINCT FROM substring(nd."idempotencyKey" from ':booking_reminder:(.*)$') THEN 'INVALID_REFERENCE'
             WHEN b."dateTimeStart" - interval '60 minutes' <= n.ts THEN 'EXPIRED' ELSE 'VALID_NOW' END
      WHEN nd."event" = 'BOOKING_RESCHEDULED' THEN
        CASE WHEN to_char(b."dateTimeStart", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
                  IS DISTINCT FROM substring(nd."idempotencyKey" from ':booking_rescheduled:(.*)$') THEN 'INVALID_REFERENCE'
             ELSE 'VALID_NOW' END
      ELSE -- BOOKING_CREATED_BY_STAFF / BOOKING_CREATED_BY_CLIENT
        CASE WHEN nd."createdAt" + interval '6 hours' <= n.ts THEN 'EXPIRED'
             WHEN nd."event" = 'BOOKING_CREATED_BY_STAFF' AND b."confirmationTokenHash" IS NOT NULL
                  AND (b."confirmationTokenUsedAt" IS NOT NULL OR b."status" <> 'PENDENTE'
                       OR b."confirmationTokenExpiresAt" IS NULL OR b."confirmationTokenExpiresAt" <= n.ts) THEN 'EXPIRED'
             ELSE 'VALID_NOW' END
    END AS classification
  FROM "NotificationDelivery" nd
  CROSS JOIN now_utc n
  LEFT JOIN "Booking" b ON b."id" = nd."bookingId" AND nd."event" <> 'PASSWORD_RESET'
  LEFT JOIN "PasswordResetToken" prt ON nd."event" = 'PASSWORD_RESET'
    AND prt."tokenHash" = substring(nd."idempotencyKey" from '^password-reset:([0-9a-f]{64})$')
  WHERE nd."status" IN ('PENDING', 'RETRY')
)
SELECT "id", "event", classification FROM c ORDER BY classification, "event";
COMMIT;
```

Última execução read-only (agregada, 2026-10-10, regra de 6h):
- **7 linhas `EXPIRED`:** 5 `BOOKING_REMINDER`, 1 `BOOKING_CREATED_BY_STAFF`, 1 `PASSWORD_RESET`.
- **2 lembretes `VALID_NOW`**, que vencem sozinhos nas próximas horas.

A contagem deve ser refeita imediatamente antes da execução.

### 2. Transação controlada

Usar a lista explícita de IDs do passo 1 **e** as condições de estado. Uma linha que mudou entre os passos fica de fora. Fazer um bloco por classificação, cada um com sua categoria (`EXPIRED` → `lifecycle_expired`, `CANCELED` → `lifecycle_canceled`, `INVALID_REFERENCE` → `lifecycle_invalid_reference`, `UNSUPPORTED_EVENT` → `lifecycle_unsupported_event`). Nunca fazer `UPDATE` genérico sobre `PENDING`.

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- :ids = IDs de UMA classificação do passo 1; :category = categoria correspondente; :expected = quantidade
WITH target AS (
  SELECT nd."id"
  FROM "NotificationDelivery" nd
  WHERE nd."id" = ANY(:ids)
    AND nd."status" IN ('PENDING', 'RETRY')
    AND nd."lockedAt" IS NULL AND nd."lockedBy" IS NULL
  FOR UPDATE NOWAIT
),
updated AS (
  UPDATE "NotificationDelivery" t
  SET "status" = 'DEAD',
      "eligibleAt" = NULL,
      "nextRetryAt" = NULL,
      "processedAt" = (now() AT TIME ZONE 'UTC'),
      "updatedAt" = (now() AT TIME ZONE 'UTC'),
      "errorCategory" = :category,
      "lastError" = 'Quarantined by lifecycle policy: invalid before WhatsApp activation'
  FROM target
  WHERE t."id" = target."id"
  RETURNING t."id", t."event"
)
SELECT "event", count(*) FROM updated GROUP BY "event";
-- Se a soma for diferente de :expected → ROLLBACK e reclassificar.

INSERT INTO "AuditLog" ("id", "actorType", "actorId", "action", "resourceType", "resourceId", "metadata", "requestId", "createdAt")
VALUES (gen_random_uuid()::text, 'OPERATOR', '<operador>', 'notification.lifecycle.quarantined', 'NotificationDelivery', NULL,
        jsonb_build_object('count', :expected, 'category', :category, 'reasonCode', 'pre_activation_lifecycle_quarantine'),
        'quarantine-<data>', (now() AT TIME ZONE 'UTC'));

COMMIT;  -- somente se a contagem conferir
```

Sintaxe validada localmente em PostgreSQL 15.8 e 17 (terminando em `ROLLBACK`).

### 3. Conflitos de concorrência

- `FOR UPDATE NOWAIT` falha imediatamente se outra transação segura a linha (por exemplo, um worker habilitado por engano). Nesse caso: `ROLLBACK`, investigar e repetir.
- A condição `status IN ('PENDING','RETRY') AND lockedBy IS NULL` exclui linhas reivindicadas no intervalo.
- Contagem diferente da esperada → `ROLLBACK`. Nunca ajustar o critério dentro da mesma transação.

### 4. Pós-verificação (read-only)

```sql
BEGIN READ ONLY;
SELECT "status", "errorCategory", count(*) FROM "NotificationDelivery" GROUP BY 1, 2 ORDER BY 1, 2;
-- Esperado: PENDING/RETRY contém apenas linhas VALID_NOW; DEAD/lifecycle_* = soma dos :expected
COMMIT;
```

### 5. Antes de habilitar o WhatsApp

1. Publicar este hardening (deploy autorizado separadamente). Com ele no ar, o cron deixa de criar lembretes enquanto o WhatsApp está desligado. Qualquer linha inválida restante é aposentada pelo worker sem chamar o provider.
2. Repetir o passo 1 imediatamente antes de ativar. O cron do código antigo pode enfileirar novos lembretes até o deploy.
3. Só então definir `WHATSAPP_ENABLED=true`.

Com o hardening em produção, a quarentena manual deixa de ser estritamente necessária: o worker aposentaria as linhas inválidas no primeiro ciclo, sem envio. Ela continua recomendada para que a limpeza seja um ato auditado e separado da ativação.

## Riscos residuais

- **Janela entre validação e envio:** existe uma janela de milissegundos entre a validação e o `send`. Um cancelamento exatamente nesse intervalo ainda pode ser enviado. Fechar essa janela exigiria segurar um lock do agendamento durante a chamada HTTP.
- **Erro persistente classificado como transitório:** um erro de programação no carregamento das referências é tratado como `TEMPORARILY_UNVERIFIABLE`. Ele não envia nada e termina em `DEAD` (`lifecycle_unverifiable_exhausted` ou `lifecycle_expired`) após o limite de tentativas ou o prazo. É visível nos logs como `notification.unverifiable`.
- **Linha presa em `PROCESSING` (pré-existente):** uma linha em `PROCESSING` com `attempts >= max` e worker morto não é recuperada (comportamento anterior, não alterado).
- **`eligibleNow` nas métricas continua operacional:** conta linhas que podem ser aposentadas no próximo ciclo.
- **Avisos de criação e reagendamento:** os avisos de criação não guardam o horário no snapshot. Um reagendamento gera seu próprio `BOOKING_RESCHEDULED`, e o aviso de criação continua limitado a 6h.
- **Cancelamento e reagendamento:** as inconsistências descritas acima permanecem até revisão explícita.
- **Replay sob indisponibilidade:** o caminho `temporarily_unverifiable` do replay está coberto pela classificação de `checkNotificationValidity`. Não há teste ponta a ponta do replay com o banco caído, porque o replay usa o cliente global dentro de uma transação.
