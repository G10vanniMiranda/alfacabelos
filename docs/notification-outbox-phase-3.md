# Fase 3 — Outbox transacional e WhatsApp resiliente

## Auditoria dos fluxos

| Fluxo | Comportamento anterior | Comportamento atual |
| --- | --- | --- |
| Cliente cria agendamento ou série | Commit dos agendamentos, consultas adicionais e envio síncrono em `Promise.all` | Agendamentos e intents para o dono são gravados na mesma transação serializável |
| Equipe cria agendamento ou série | Commit, recarga de cada ocorrência e envio síncrono ao cliente | Agendamentos, tokens de confirmação e intents são gravados juntos |
| Equipe cancela ocorrência/série | Alterava o domínio e notificava cada cliente depois do commit | Cancelamento e intents para os clientes estão na mesma transação |
| Cliente cancela ocorrência/série | Alterava o domínio e notificava o dono depois do commit | Cancelamento e intents para o dono estão na mesma transação |
| Equipe reagenda ocorrência/série | Alterava todas as ocorrências e depois disparava envios paralelos | Alterações e snapshots das mensagens estão na mesma transação |
| Cliente reagenda | Atualizava e notificava o dono depois do commit | Atualização e intent para o dono estão na mesma transação serializável |
| Recuperação de senha | Criava o token e chamava o provedor no Server Action | Token e intent são gravados na mesma transação; a resposta continua genérica |
| Lembrete | O enum existia, mas não havia produtor | O worker cria intents idempotentes na janela configurada antes de processar o lote |
| Confirmação de agendamento | Não havia notificação automática | Permanece sem notificação: a confirmação somente muda o estado do domínio |

Antes desta fase, `NotificationDelivery` não era uma outbox assíncrona completa: `dispatchWhatsAppNotification` fazia claim na aplicação e chamava o provedor dentro da própria requisição. O retry também selecionava linhas sem `SKIP LOCKED`, portanto dois processos podiam disputar o mesmo item.

## Arquitetura

`NotificationDelivery` é a única fonte da fila. Não foi criada uma tabela concorrente. A chave `idempotencyKey` continua única e inclui o agregado, destinatário, evento e, para eventos repetíveis, a versão temporal (data/hora do agendamento).

O fluxo é:

1. A transação de negócio salva a alteração e o snapshot mínimo necessário para enviar a mensagem.
2. O endpoint de cron cria lembretes devidos e chama o worker.
3. O worker faz um claim atômico e curto com `FOR UPDATE SKIP LOCKED`.
4. A transação termina antes de qualquer chamada de rede.
5. Até cinco envios são executados em paralelo por padrão.
6. Cada resultado é persistido como `SENT`, `RETRY` ou `DEAD`, desde que `lockedBy` ainda pertença ao worker.

Estados novos:

- `PENDING`: pronto para a primeira tentativa.
- `PROCESSING`: reservado por um worker (`lockedAt` e `lockedBy`).
- `SENT`: aceito pelo provedor; registra `sentAt`, `processedAt` e, quando disponível, `providerMessageId`.
- `RETRY`: falha transitória com `nextRetryAt`.
- `DEAD`: falha permanente ou limite de tentativas atingido.

Estados legados (`NOT_CONFIGURED`, `SENDING`, `FAILED`) são convertidos pela migração. Locks com mais de cinco minutos são recuperados no próximo claim.

O claim usa ordenação determinística e uma única instrução `UPDATE ... FROM (...) RETURNING`. Esse padrão é indicado para múltiplos consumidores de uma tabela semelhante a fila; `SKIP LOCKED` evita que um worker espere as linhas já reservadas por outro. Veja a [documentação do PostgreSQL](https://www.postgresql.org/docs/current/sql-select.html).

## Política de falhas

- Transitórias: timeout, rede, HTTP 408, 429 e 5xx. Recebem backoff exponencial a partir de 30 segundos, teto de uma hora e jitter de até 25%.
- Permanentes: telefone ou payload inválido, credencial/configuração ausente, HTTP 4xx que não seja 408/429.
- Limite padrão: oito tentativas, configurável até vinte.
- Timeout padrão do provedor: dez segundos, limitado entre um e trinta segundos.
- O provedor recebe `Idempotency-Key` com a mesma chave da outbox.

Não existe garantia universal de exactly-once em uma API HTTP. Se o provedor aceitar a mensagem e a função morrer antes de persistir `SENT`, um lock vencido poderá reenviar. A chave no header reduz esse risco apenas quando o provedor oferece idempotência. Para garantia mais forte, o adaptador deve usar a idempotência ou consulta de status específica do fornecedor.

## Cron e operação

O endpoint é `GET /api/internal/notifications/process`. Ele:

- exige `Authorization: Bearer <CRON_SECRET>` e compara o segredo em tempo constante;
- não responde CORS e envia `cache-control: no-store`;
- aplica rate limit persistente de vinte chamadas por minuto por origem;
- limita lote, concorrência, duração e limpeza de histórico;
- retorna somente contadores e identificadores técnicos, sem telefone, mensagem ou token.

O `vercel.json` agenda a rota a cada cinco minutos. Vercel Cron chama rotas por `GET` e envia `CRON_SECRET` automaticamente no header de autorização, conforme a [documentação oficial](https://vercel.com/docs/cron-jobs/manage-cron-jobs). Essa frequência exige um plano que aceite mais de uma execução diária; no Hobby, a Vercel restringe crons a uma execução por dia. Em outra infraestrutura, execute `npm run notifications:process -- 25` com o mesmo ambiente.

Variáveis:

```dotenv
CRON_SECRET=<aleatório-com-pelo-menos-16-caracteres>
NOTIFICATION_BATCH_SIZE=25
NOTIFICATION_CONCURRENCY=5
NOTIFICATION_MAX_ATTEMPTS=8
NOTIFICATION_RETENTION_DAYS=90
NOTIFICATION_DEAD_RETENTION_DAYS=365
NOTIFICATION_REMINDER_LEAD_MINUTES=1440
NOTIFICATION_REMINDER_WINDOW_MINUTES=10
WHATSAPP_REQUEST_TIMEOUT_MS=10000
```

Com `WHATSAPP_ENABLED` diferente de `true`, o worker não faz claim: as intents permanecem duráveis em `PENDING`. Se o envio estiver habilitado com URL/token inválido, a falha é permanente e segue para `DEAD`.

## Observabilidade e LGPD

O resumo do lote expõe `claimed`, `sent`, `retry`, `dead`, duração e profundidade atual por estado. Cada conclusão registra `deliveryId`, tipo, tentativa, resultado e categoria de erro. Logs nunca incluem telefone, mensagem, token, header de autorização ou resposta bruta do provedor.

O snapshot contém destinatário e mensagem porque links temporários e dados de reagendamento precisam refletir o evento no momento do commit. Isso é dado pessoal. A função de limpeza está preparada, mas não é chamada pelo cron nem foi executada. A proposta é reter `SENT` por 90 dias e `DEAD` por 365 dias, removendo no máximo 500 por execução depois de aprovação formal da política. O acesso público segue bloqueado por RLS e pelos grants existentes.

Consultas operacionais úteis:

```sql
SELECT "status", count(*) FROM "NotificationDelivery" GROUP BY "status";

SELECT "id", "event", "attempts", "errorCategory", "lastError", "createdAt"
FROM "NotificationDelivery"
WHERE "status" = 'DEAD'
ORDER BY "createdAt" DESC
LIMIT 100;
```

Um replay manual deve ser explícito e auditado: altere apenas os IDs revisados para `RETRY`, zere `nextRetryAt`, `lockedAt`, `lockedBy` e corrija antes a causa permanente. Não faça replay em massa de `SENT`.

## Testes e implantação

- Os testes unitários usam `fetch` falso e cobrem normalização, timeout, classificação, ausência de retry inline e backoff/jitter.
- Os testes de integração cobrem chave única, rollback, dois claims concorrentes, dois workers sem envio duplicado e transição `RETRY`/`DEAD`.
- Integração só roda quando `RUN_DATABASE_TESTS=true` e a URL aponta para banco local/CI descartável. O CI cria PostgreSQL 16, aplica todas as migrações e habilita essa flag.
- Nenhum teste usa credenciais ou chama o provedor real.

Implantação segura: aplicar primeiro a migração `20260801160000_harden_notification_outbox`, configurar as variáveis, fazer deploy da aplicação e então habilitar `WHATSAPP_ENABLED=true`. A migração e o código desta fase não foram aplicados remotamente por este trabalho.
