---
name: alfa-evolution-operations
description: Operate and troubleshoot the ALFA-CABELOS Evolution/WhatsApp outbox, provider, worker, cron, retries, DEAD items, replay, health, and controlled homologation.
---

# ALFA-CABELOS Evolution and WhatsApp operations

Read [notification-outbox-phase-3.md](../../../docs/notification-outbox-phase-3.md) for architecture and [operations.md](../../../docs/runbooks/operations.md) for incident procedures when the task concerns delivery failures, backlog, worker health, or replay.

## Architecture invariants

- Business mutations and notification intents commit in the same database transaction.
- `NotificationDelivery` is the single outbox. Its unique `idempotencyKey` is the canonical identity.
- Workers claim short transactions with `FOR UPDATE SKIP LOCKED`, release the transaction before network I/O, and update only rows still owned by their `lockedBy` value.
- States are `PENDING`, `PROCESSING`, `SENT`, `RETRY`, and `DEAD`. Expired locks may be reclaimed.
- Persist `providerMessageId` when the provider returns one. The `Idempotency-Key` header reduces duplicates only if the provider honors it; never claim exactly-once HTTP delivery.
- HTTP 408, 429, network failures, timeouts, and 5xx are transient. Invalid recipient/payload/configuration and other non-408/429 4xx failures are permanent unless provider evidence says otherwise.
- Replay is individual, ADMIN-only, same-origin, rate-limited, justified, audited, and limited to reviewed `DEAD` rows. Never replay `SENT` or bulk-update the queue.

## Safety boundary

Never send a real message during automated tests, diagnosis, health checks, or speculative verification. Mocks must intercept `fetch`; test environments keep `WHATSAPP_ENABLED=false`.

A real homologation send requires all of the following immediately before execution:

1. an isolated homologation database, Vercel project, Storage, secrets, and Evolution instance;
2. one explicitly authorized test number and an approved message;
3. explicit authorization for the send in the current task;
4. migrations applied and `/api/ready` healthy in homologation;
5. a plan to capture the outbox ID, provider response category, `providerMessageId`, logs, heartbeat, and duplicate count without exposing PII or secrets.

Stop after one controlled send unless a wider test count was explicitly authorized. Do not use a customer number.

## Troubleshooting order

Check configuration presence without printing values; `/api/health`, `/api/ready`, admin operations status, worker heartbeat, queue counts/age, recent sanitized categories, cron invocation, and provider status. Correct configuration or provider cause before replay. Preserve pending intents during an outage and drain at normal limits after recovery.

Classify current status separately as code implemented, local configuration, homologation evidence, and production evidence. One does not imply another.

