import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { beforeEach, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { prisma } from "../lib/prisma";
import {
  claimNotificationBatch,
  enqueueWhatsAppNotification,
  processNotificationBatch,
} from "../lib/notifications/service";
import { createBookingSeriesAtomic } from "../lib/booking-series-service";
import { checkNotificationValidity, type NotificationValidity } from "../lib/notifications/validity-policy";
import { enqueueBookingNotification, enqueueDueBookingReminders } from "../lib/notifications/booking-intents";
import { hashPasswordResetToken } from "../lib/auth/password-reset-security";
import { zonedDateTimeToUtcIso } from "../lib/utils";
import { getOperationalNotificationMetrics } from "../lib/observability/metrics";
import { recordAuditEvent } from "../lib/observability/audit";
import { replayDeadNotification } from "../lib/notifications/replay";
import { confirmBookingByToken, createBarberBooking } from "../lib/booking-service";
import { cancelBookingSeries } from "../lib/booking-series-service";
import {
  createPasswordResetForIdentifier,
  registerPasswordResetAttempt,
  resetClientPasswordWithToken,
  validatePasswordResetToken,
} from "../lib/auth/client-password-reset-store";
import {
  authenticateClient,
  createClientSession,
  findClientBySessionToken,
} from "../lib/auth/client-store";

const databaseUrl = process.env.DATABASE_URL ?? "";
const disposable = process.env.RUN_DATABASE_TESTS === "true"
  && (/localhost|127\.0\.0\.1/.test(databaseUrl) || /_ci(?:\?|$)/.test(databaseUrl));

beforeEach(async () => {
  if (disposable) await prisma.notificationDelivery.deleteMany();
});

// Transport-mechanics tests (claim, retry, concurrency) are independent of the
// business lifecycle policy, which has its own tests below.
const alwaysValid = async (): Promise<NotificationValidity> => ({ outcome: "VALID", validUntil: null });

async function createResetTokenKey(input: { clientId?: string; expiresAt?: Date; usedAt?: Date | null } = {}): Promise<string> {
  const clientId = input.clientId ?? (await prisma.client.create({ data: {
    name: `Lifecycle Fixture ${randomUUID()}`, phone: `69${randomUUID().replace(/\D/g, "").slice(0, 9).padEnd(9, "1")}`,
    phoneNormalized: `fixture-${randomUUID()}`, hasPassword: false,
  } })).id;
  const tokenHash = hashPasswordResetToken(randomUUID());
  await prisma.passwordResetToken.create({ data: {
    clientId, tokenHash, expiresAt: input.expiresAt ?? new Date(Date.now() + 30 * 60_000), usedAt: input.usedAt ?? null,
  } });
  return `password-reset:${tokenHash}`;
}

test("idempotency key creates only one outbox row", { skip: !disposable }, async () => {
  const key = `test:${randomUUID()}`;
  await Promise.all(Array.from({ length: 8 }, () => enqueueWhatsAppNotification(prisma, {
    event: "PASSWORD_RESET", to: "(69) 99999-1234", message: "Teste", context: "integration", idempotencyKey: key,
  })));
  assert.equal(await prisma.notificationDelivery.count({ where: { idempotencyKey: key } }), 1);
});

test("transaction rollback does not leave an orphan notification", { skip: !disposable }, async () => {
  const key = `rollback:${randomUUID()}`;
  await assert.rejects(prisma.$transaction(async (tx) => {
    await enqueueWhatsAppNotification(tx, {
      event: "PASSWORD_RESET", to: "(69) 99999-1234", message: "Teste", context: "integration", idempotencyKey: key,
    });
    throw new Error("rollback");
  }));
  assert.equal(await prisma.notificationDelivery.count({ where: { idempotencyKey: key } }), 0);
});

test("two concurrent SKIP LOCKED claims never return the same delivery", { skip: !disposable }, async () => {
  for (let index = 0; index < 20; index += 1) {
    await enqueueWhatsAppNotification(prisma, {
      event: "PASSWORD_RESET", to: "(69) 99999-1234", message: `Teste ${index}`, context: "integration",
      idempotencyKey: `claim:${randomUUID()}`,
    });
  }
  const [first, second] = await Promise.all([
    claimNotificationBatch({ workerId: "worker-a", batchSize: 20 }),
    claimNotificationBatch({ workerId: "worker-b", batchSize: 20 }),
  ]);
  const ids = [...first, ...second].map((item) => item.id);
  assert.equal(ids.length, 20);
  assert.equal(new Set(ids).size, 20);
});

test("claim ignores historical and structurally ineligible deliveries", { skip: !disposable }, async () => {
  const now = new Date();
  const base = {
    event: "PASSWORD_RESET" as const,
    recipient: "+5569999991234",
    recipientMasked: "*********1234",
    message: "Teste",
    context: "eligibility-integration",
  };
  const ids = {
    retryWithoutEligibility: `legacy-retry:${randomUUID()}`,
    deadWithEligibility: `legacy-dead:${randomUUID()}`,
    pendingWithoutEligibility: `legacy-pending:${randomUUID()}`,
    futureRetry: `future-retry:${randomUUID()}`,
    dueRetry: `due-retry:${randomUUID()}`,
    newPending: `new-pending:${randomUUID()}`,
  };
  await prisma.notificationDelivery.createMany({ data: [
    { ...base, idempotencyKey: ids.retryWithoutEligibility, status: "RETRY", eligibleAt: null },
    { ...base, idempotencyKey: ids.deadWithEligibility, status: "DEAD", eligibleAt: now },
    { ...base, idempotencyKey: ids.pendingWithoutEligibility, status: "PENDING", eligibleAt: null },
    { ...base, idempotencyKey: ids.futureRetry, status: "RETRY", eligibleAt: now, nextRetryAt: new Date(now.getTime() + 60_000) },
    { ...base, idempotencyKey: ids.dueRetry, status: "RETRY", eligibleAt: now, nextRetryAt: new Date(now.getTime() - 1_000) },
  ] });
  await enqueueWhatsAppNotification(prisma, {
    event: "PASSWORD_RESET", to: base.recipient, message: base.message, context: base.context,
    idempotencyKey: ids.newPending,
  });

  // enqueueWhatsAppNotification stamps eligibleAt with its own clock, after `now`.
  const claimed = await claimNotificationBatch({ workerId: "eligibility-worker", batchSize: 10, now: new Date(now.getTime() + 1_000) });
  assert.deepEqual(new Set(claimed.map((item) => item.idempotencyKey)), new Set([ids.dueRetry, ids.newPending]));
});

test("stale processing locks are recovered by another worker", { skip: !disposable }, async () => {
  const key = `stale:${randomUUID()}`;
  await enqueueWhatsAppNotification(prisma, {
    event: "PASSWORD_RESET", to: "(69) 99999-1234", message: "Teste", context: "integration", idempotencyKey: key,
  });
  await prisma.notificationDelivery.update({
    where: { idempotencyKey: key },
    data: { status: "PROCESSING", lockedAt: new Date(0), lockedBy: "dead-worker" },
  });
  const claimed = await claimNotificationBatch({ workerId: "recovery-worker", batchSize: 1 });
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0]?.idempotencyKey, key);
  assert.equal(claimed[0]?.attempts, 1);
});

test("concurrent workers send each delivery at most once", { skip: !disposable }, async () => {
  process.env.WHATSAPP_ENABLED = "true";
  for (let index = 0; index < 12; index += 1) {
    await enqueueWhatsAppNotification(prisma, {
      event: "PASSWORD_RESET", to: "(69) 99999-1234", message: `Teste ${index}`, context: "integration",
      idempotencyKey: `send:${randomUUID()}`,
    });
  }
  const calls: string[] = [];
  const send = async (input: { idempotencyKey: string }) => {
    calls.push(input.idempotencyKey);
    return { ok: true as const, providerMessageId: `provider:${input.idempotencyKey}` };
  };
  await Promise.all([
    processNotificationBatch({ workerId: "worker-a", batchSize: 12, send, validate: alwaysValid }),
    processNotificationBatch({ workerId: "worker-b", batchSize: 12, send, validate: alwaysValid }),
  ]);
  assert.equal(calls.length, 12);
  assert.equal(new Set(calls).size, 12);
  assert.equal(await prisma.notificationDelivery.count({ where: { status: "SENT" } }), 12);
});

test("transient failures retry and permanent failures become dead", { skip: !disposable }, async () => {
  process.env.WHATSAPP_ENABLED = "true";
  const key = `retry:${randomUUID()}`;
  await enqueueWhatsAppNotification(prisma, {
    event: "PASSWORD_RESET", to: "(69) 99999-1234", message: "Teste", context: "integration", idempotencyKey: key,
  });
  await processNotificationBatch({
    workerId: "worker-retry", batchSize: 1, random: () => 0, validate: alwaysValid,
    send: async () => ({ ok: false, retryable: true, category: "network", error: "network" }),
  });
  const retry = await prisma.notificationDelivery.findUniqueOrThrow({ where: { idempotencyKey: key } });
  assert.equal(retry.status, "RETRY");
  assert.equal(retry.attempts, 1);
  assert.ok(retry.nextRetryAt);

  await prisma.notificationDelivery.update({ where: { id: retry.id }, data: { nextRetryAt: new Date(0) } });
  await processNotificationBatch({
    workerId: "worker-dead", batchSize: 1, validate: alwaysValid,
    send: async () => ({ ok: false, retryable: false, category: "invalid_payload", error: "invalid" }),
  });
  const dead = await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: retry.id } });
  assert.equal(dead.status, "DEAD");
  assert.equal(dead.attempts, 2);
  assert.equal(dead.nextRetryAt, null);
});

test("a transient failure becomes dead when max attempts is exhausted", { skip: !disposable }, async () => {
  process.env.WHATSAPP_ENABLED = "true";
  const previousMax = process.env.NOTIFICATION_MAX_ATTEMPTS;
  process.env.NOTIFICATION_MAX_ATTEMPTS = "1";
  const key = `exhausted:${randomUUID()}`;
  try {
    await enqueueWhatsAppNotification(prisma, {
      event: "PASSWORD_RESET", to: "(69) 99999-1234", message: "Teste", context: "integration", idempotencyKey: key,
    });
    await processNotificationBatch({
      workerId: "worker-exhausted", batchSize: 1, validate: alwaysValid,
      send: async () => ({ ok: false, retryable: true, category: "timeout", error: "timeout" }),
    });
    const delivery = await prisma.notificationDelivery.findUniqueOrThrow({ where: { idempotencyKey: key } });
    assert.equal(delivery.status, "DEAD");
    assert.equal(delivery.attempts, 1);
    assert.equal(delivery.errorCategory, "timeout");
  } finally {
    if (previousMax === undefined) delete process.env.NOTIFICATION_MAX_ATTEMPTS;
    else process.env.NOTIFICATION_MAX_ATTEMPTS = previousMax;
  }
});

test("outbox metrics separate backlog from deliveries eligible now", { skip: !disposable }, async () => {
  const now = new Date();
  const base = {
    event: "PASSWORD_RESET" as const,
    recipient: "+5569999991234",
    recipientMasked: "*********1234",
    message: "Teste",
    context: "observability-integration",
  };
  await prisma.notificationDelivery.createMany({ data: [
    { ...base, idempotencyKey: `metrics-pending:${randomUUID()}`, status: "PENDING", eligibleAt: now, createdAt: new Date(now.getTime() - 20 * 60_000) },
    { ...base, idempotencyKey: `metrics-pending-ineligible:${randomUUID()}`, status: "PENDING", eligibleAt: null },
    { ...base, idempotencyKey: `metrics-retry:${randomUUID()}`, status: "RETRY", attempts: 2, eligibleAt: now, nextRetryAt: now },
    { ...base, idempotencyKey: `metrics-retry-backoff:${randomUUID()}`, status: "RETRY", attempts: 2, eligibleAt: now, nextRetryAt: new Date(now.getTime() + 60_000) },
    { ...base, idempotencyKey: `metrics-retry-exhausted:${randomUUID()}`, status: "RETRY", attempts: 20, eligibleAt: now, nextRetryAt: now },
    { ...base, idempotencyKey: `metrics-sent:${randomUUID()}`, status: "SENT", sentAt: now, processedAt: now, createdAt: new Date(now.getTime() - 2_000) },
    { ...base, idempotencyKey: `metrics-dead:${randomUUID()}`, status: "DEAD", attempts: 5, processedAt: now },
  ] });
  const metrics = await getOperationalNotificationMetrics(now);
  assert.equal(metrics.backlog, 5);
  assert.equal(metrics.eligibleNow, 2);
  assert.equal(metrics.dead24h, 1);
  assert.equal(metrics.sent24h, 1);
  assert.equal(metrics.successRate24h, 0.5);
  assert.ok((metrics.oldestPendingAgeSeconds ?? 0) >= 1_199);
  assert.ok((metrics.p95DeliveryMs24h ?? 0) >= 1_900);
  assert.equal(metrics.byEventType.some((group) => group.eventType === "PASSWORD_RESET" && group.status === "DEAD"), true);
});

test("audit log is sanitized and append-only", { skip: !disposable }, async () => {
  const requestId = `audit-${randomUUID()}`;
  const created = await recordAuditEvent(prisma, {
    actorType: "ADMIN", actorId: "integration-admin", action: "service.updated",
    resourceType: "Service", resourceId: randomUUID(), requestId,
    metadata: { customerName: "must-not-be-stored", scope: "integration", token: "must-be-redacted" },
  });
  const audit = await prisma.auditLog.findUniqueOrThrow({ where: { id: created.id } });
  assert.deepEqual(audit.metadata, { scope: "integration", token: "[REDACTED]" });
  await assert.rejects(prisma.auditLog.update({ where: { id: created.id }, data: { action: "tampered" } }));
  await assert.rejects(prisma.auditLog.delete({ where: { id: created.id } }));
});

test("only a DEAD notification can be manually replayed once and replay is audited", { skip: !disposable }, async () => {
  const requestId = `replay-${randomUUID()}`;
  const dead = await prisma.notificationDelivery.create({ data: {
    event: "PASSWORD_RESET", recipient: "+5569999991234", recipientMasked: "*********1234",
    message: "Teste", context: "replay-integration", idempotencyKey: await createResetTokenKey(),
    status: "DEAD", attempts: 5, errorCategory: "timeout", processedAt: new Date(),
  } });
  const replayed = await replayDeadNotification({
    notificationId: dead.id, actorId: "integration-admin", requestId, reason: "verified_provider_recovery",
  });
  assert.deepEqual(replayed, { ok: true, notificationId: dead.id, replayCount: 1 });
  const updated = await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: dead.id } });
  assert.equal(updated.status, "RETRY");
  assert.equal(updated.attempts, 0);
  assert.ok(updated.eligibleAt);
  assert.ok(updated.nextRetryAt);
  assert.equal(updated.lockedAt, null);
  assert.equal(updated.lockedBy, null);
  assert.equal(updated.replayCount, 1);
  assert.equal(await prisma.auditLog.count({ where: { requestId, action: "notification.dead.replayed", resourceId: dead.id } }), 1);
  assert.deepEqual(await replayDeadNotification({
    notificationId: dead.id, actorId: "integration-admin", requestId: `${requestId}-again`, reason: "duplicate_attempt",
  }), { ok: false, reason: "already_replayed" });

  const sent = await prisma.notificationDelivery.create({ data: {
    event: "PASSWORD_RESET", recipient: "+5569999991234", recipientMasked: "*********1234",
    message: "Teste", context: "replay-sent", idempotencyKey: `sent-replay:${randomUUID()}`,
    status: "SENT", attempts: 1, sentAt: new Date(), processedAt: new Date(),
  } });
  assert.deepEqual(await replayDeadNotification({
    notificationId: sent.id, actorId: "integration-admin", requestId: `${requestId}-sent`, reason: "must_be_rejected",
  }), { ok: false, reason: "not_dead" });
});

test("password recovery covers legacy phone, barber lifecycle, resend, expiry, single-use and session revocation", { skip: !disposable }, async () => {
  const phone = `69${String(Date.now()).slice(-9)}`;
  const legacyPhoneNormalized = `55${phone}`;
  const client = await prisma.client.create({
    data: {
      name: `Recovery Client ${randomUUID()}`,
      phone: `+55${phone}`,
      phoneNormalized: legacyPhoneNormalized,
      passwordHash: null,
      hasPassword: false,
      status: "PENDING",
      createdBy: "BARBER",
    },
  });
  try {
    assert.equal(await createPasswordResetForIdentifier("(11) 98888-7777"), undefined);

    const first = await createPasswordResetForIdentifier(`(${phone.slice(0, 2)}) ${phone.slice(2, 7)}-${phone.slice(7)}`);
    const firstToken = new URL(first!.resetLink).searchParams.get("token")!;
    assert.deepEqual(await validatePasswordResetToken(firstToken), { valid: true, status: "valid" });
    assert.equal(await resetClientPasswordWithToken(firstToken, "PrimeiraSenha#2026"), true);
    assert.equal((await authenticateClient(phone, "PrimeiraSenha#2026"))?.id, client.id);
    assert.deepEqual(await validatePasswordResetToken(firstToken), { valid: false, status: "used" });

    const oldSession = await createClientSession(client.id);
    const resendOne = await createPasswordResetForIdentifier(`55${phone}`);
    const resendTwo = await createPasswordResetForIdentifier(`+55${phone}`);
    const resendOneToken = new URL(resendOne!.resetLink).searchParams.get("token")!;
    const resendTwoToken = new URL(resendTwo!.resetLink).searchParams.get("token")!;
    assert.notEqual(resendOneToken, resendTwoToken);
    assert.deepEqual(await validatePasswordResetToken(resendOneToken), { valid: false, status: "used" });

    await prisma.passwordResetToken.update({
      where: { tokenHash: (await prisma.passwordResetToken.findFirstOrThrow({
        where: { clientId: client.id, usedAt: null },
        select: { tokenHash: true },
      })).tokenHash },
      data: { expiresAt: new Date(0) },
    });
    assert.deepEqual(await validatePasswordResetToken(resendTwoToken), { valid: false, status: "expired" });
    assert.equal(await resetClientPasswordWithToken(resendTwoToken, "NaoPode#2026"), false);

    const finalReset = await createPasswordResetForIdentifier(phone);
    const finalToken = new URL(finalReset!.resetLink).searchParams.get("token")!;
    assert.equal(await resetClientPasswordWithToken(finalToken, "NovaSenha#2026"), true);
    assert.equal(await findClientBySessionToken(oldSession.token), undefined);
    assert.equal(await authenticateClient(phone, "PrimeiraSenha#2026"), null);
    assert.equal((await authenticateClient(phone, "NovaSenha#2026"))?.id, client.id);
    assert.equal(await prisma.notificationDelivery.count({ where: { recipient: `+55${phone}`, event: "PASSWORD_RESET" } }), 4);

    const firstAttempt = await registerPasswordResetAttempt(phone, "127.0.0.77", `rate-${randomUUID()}`);
    const immediateResend = await registerPasswordResetAttempt(phone, "127.0.0.77", `rate-${randomUUID()}`);
    assert.equal(firstAttempt.blocked, false);
    assert.equal(immediateResend.blocked, true);
    assert.ok(immediateResend.retryAfterSeconds > 0);
  } finally {
    await prisma.notificationDelivery.deleteMany({ where: { recipient: `+55${phone}` } });
    await prisma.passwordResetToken.deleteMany({ where: { clientId: client.id } });
    await prisma.clientSession.deleteMany({ where: { clientId: client.id } });
    await prisma.client.delete({ where: { id: client.id } });
    await prisma.securityRateLimitEvent.deleteMany({
      where: { scope: { in: ["client-password-reset-cooldown", "client-password-reset-pair", "client-password-reset-ip"] } },
    });
  }
});

test("concurrent confirmation, cancellation, series, replay and password reset converge safely", { skip: !disposable }, async () => {
  const runId = randomUUID();
  const phone = `69${String(Date.now()).slice(-9)}`;
  const barber = await prisma.barber.create({ data: { name: `Concurrency Barber ${runId}` } });
  const service = await prisma.service.create({ data: { name: `Concurrency Service ${runId}`, durationMinutes: 30, priceCents: 3000 } });
  const client = await prisma.client.create({ data: { name: `Concurrency Client ${runId}`, phone, phoneNormalized: phone, hasPassword: false, status: "PENDING", createdBy: "BARBER" } });
  const bookingIds: string[] = [];
  try {
    const confirmable = await createBarberBooking({
      barberId: barber.id, serviceId: service.id, customerName: client.name, customerPhone: phone,
      start: "2038-01-04T13:00:00.000Z",
    });
    bookingIds.push(confirmable.id);
    const confirmations = await Promise.allSettled([
      confirmBookingByToken(confirmable.confirmationToken), confirmBookingByToken(confirmable.confirmationToken),
    ]);
    assert.equal(confirmations.filter((item) => item.status === "fulfilled").length, 2);
    assert.equal(confirmations.filter((item) => item.status === "rejected").length, 0);
    assert.equal(new Set(confirmations.flatMap((item) => item.status === "fulfilled" ? [item.value.id] : [])).size, 1);
    assert.equal((await prisma.booking.findUniqueOrThrow({ where: { id: confirmable.id } })).status, "CONFIRMADO");

    const cancellable = await prisma.booking.create({ data: {
      barberId: barber.id, serviceId: service.id, clientId: client.id, customerName: client.name,
      customerPhone: phone, dateTimeStart: new Date("2038-01-04T14:00:00.000Z"), dateTimeEnd: new Date("2038-01-04T14:30:00.000Z"), createdBy: "CLIENT",
    } });
    bookingIds.push(cancellable.id);
    const cancellations = await Promise.all([
      cancelBookingSeries({ bookingId: cancellable.id, scope: "SINGLE", clientId: client.id }),
      cancelBookingSeries({ bookingId: cancellable.id, scope: "SINGLE", clientId: client.id }),
    ]);
    assert.equal(cancellations.reduce((sum, item) => sum + item.count, 0), 1);
    assert.equal((await prisma.booking.findUniqueOrThrow({ where: { id: cancellable.id } })).status, "CANCELADO");

    const seriesInput = {
      barberId: barber.id, serviceId: service.id, clientId: client.id, customerName: client.name,
      customerPhone: phone, start: "2038-01-05T13:00:00.000Z", recurrence: "DAILY" as const,
      repeatUntil: "2038-01-06", idempotencyKey: `series-race:${runId}`, createdBy: "CLIENT" as const,
    };
    const seriesResults = await Promise.all([createBookingSeriesAtomic(seriesInput), createBookingSeriesAtomic(seriesInput)]);
    assert.equal(new Set(seriesResults.map((item) => item.seriesId)).size, 1);
    assert.equal(seriesResults.filter((item) => item.duplicate).length, 1);
    bookingIds.push(...seriesResults[0]!.bookingIds);

    const dead = await prisma.notificationDelivery.create({ data: {
      event: "PASSWORD_RESET", recipient: phone, recipientMasked: "*******0000", message: "Teste",
      context: "concurrent-replay", idempotencyKey: await createResetTokenKey({ clientId: client.id }), status: "DEAD", attempts: 8, processedAt: new Date(),
    } });
    const replays = await Promise.allSettled([
      replayDeadNotification({ notificationId: dead.id, actorId: "admin-a", requestId: `replay-a:${runId}`, reason: "controlled_concurrency" }),
      replayDeadNotification({ notificationId: dead.id, actorId: "admin-a", requestId: `replay-b:${runId}`, reason: "controlled_concurrency" }),
    ]);
    assert.equal(replays.filter((item) => item.status === "rejected").length, 0);
    assert.equal(replays.filter((item) => item.status === "fulfilled" && item.value.ok).length, 1);
    assert.equal((await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: dead.id } })).replayCount, 1);

    const reset = await createPasswordResetForIdentifier(phone);
    const resetToken = new URL(reset!.resetLink, "http://localhost").searchParams.get("token")!;
    const resets = await Promise.allSettled([
      resetClientPasswordWithToken(resetToken, "Concurrent#Password2026"),
      resetClientPasswordWithToken(resetToken, "Concurrent#Password2026"),
    ]);
    assert.equal(resets.filter((item) => item.status === "rejected").length, 0);
    assert.deepEqual(resets.map((item) => item.status === "fulfilled" ? item.value : null).sort(), [false, true]);
  } finally {
    await prisma.notificationDelivery.deleteMany({ where: { OR: [{ bookingId: { in: bookingIds } }, { recipient: phone }] } });
    await prisma.booking.deleteMany({ where: { barberId: barber.id } });
    await prisma.bookingSeries.deleteMany({ where: { barberId: barber.id } });
    await prisma.passwordResetToken.deleteMany({ where: { clientId: client.id } });
    await prisma.client.deleteMany({ where: { id: client.id } });
    await prisma.service.deleteMany({ where: { id: service.id } });
    await prisma.barber.deleteMany({ where: { id: barber.id } });
  }
});

test("series with 1, 10 and 59 bookings create the same number of intents without network calls", { skip: !disposable }, async () => {
  const previousOwner = process.env.WHATSAPP_OWNER_PHONE;
  const previousFetch = globalThis.fetch;
  process.env.WHATSAPP_OWNER_PHONE = "(69) 99999-1234";
  let externalCalls = 0;
  globalThis.fetch = async () => { externalCalls += 1; throw new Error("network must not be called while creating a series"); };
  const barber = await prisma.barber.create({ data: { name: `Outbox Barber ${randomUUID()}` } });
  const service = await prisma.service.create({
    data: { name: `Outbox Service ${randomUUID()}`, durationMinutes: 15, priceCents: 3000 },
  });
  await prisma.barberAvailability.createMany({
    data: Array.from({ length: 7 }, (_, dayOfWeek) => ({ barberId: barber.id, dayOfWeek, openTime: "08:00", closeTime: "20:00" })),
  });
  try {
    const make = (localDate: string, recurrence: "NONE" | "DAILY", repeatUntil?: string, idempotencyKey = randomUUID()) => ({
      serviceId: service.id,
      barberId: barber.id,
      customerName: "Cliente Outbox",
      customerPhone: "(69) 99999-1234",
      start: zonedDateTimeToUtcIso(localDate, "09:00:00", "America/Porto_Velho"),
      recurrence,
      repeatUntil,
      idempotencyKey,
      createdBy: "CLIENT" as const,
    });
    const one = await createBookingSeriesAtomic(make("2037-01-05", "NONE"));
    const tenInput = make("2037-02-01", "DAILY", "2037-02-10");
    const ten = await createBookingSeriesAtomic(tenInput);
    const repeatedTen = await createBookingSeriesAtomic(tenInput);
    const fiftyNine = await createBookingSeriesAtomic(make("2037-03-01", "DAILY", "2037-04-28"));
    assert.equal(one.bookingIds.length, 1);
    assert.equal(ten.bookingIds.length, 10);
    assert.equal(repeatedTen.duplicate, true);
    assert.equal(fiftyNine.bookingIds.length, 59);
    assert.equal(await prisma.notificationDelivery.count(), 70);
    const payload = await prisma.notificationDelivery.findFirstOrThrow({ where: { bookingId: one.bookingIds[0] } });
    assert.match(payload.message, /Cliente Outbox/);
    assert.equal(payload.recipientMasked.endsWith("1234"), true);
    assert.equal(payload.seriesId, null);
    assert.equal(externalCalls, 0);
  } finally {
    await prisma.notificationDelivery.deleteMany();
    await prisma.booking.deleteMany({ where: { barberId: barber.id } });
    await prisma.bookingSeries.deleteMany({ where: { barberId: barber.id } });
    await prisma.barberAvailability.deleteMany({ where: { barberId: barber.id } });
    await prisma.service.delete({ where: { id: service.id } });
    await prisma.barber.delete({ where: { id: barber.id } });
    globalThis.fetch = previousFetch;
    if (previousOwner === undefined) delete process.env.WHATSAPP_OWNER_PHONE;
    else process.env.WHATSAPP_OWNER_PHONE = previousOwner;
  }
});

// ---------------------------------------------------------------------------
// Notification lifecycle policy (business validity before the provider call)
// ---------------------------------------------------------------------------

async function withWhatsApp<T>(enabled: boolean, fn: () => Promise<T>): Promise<T> {
  const previous = process.env.WHATSAPP_ENABLED;
  if (enabled) process.env.WHATSAPP_ENABLED = "true";
  else delete process.env.WHATSAPP_ENABLED;
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.WHATSAPP_ENABLED;
    else process.env.WHATSAPP_ENABLED = previous;
  }
}

async function createLifecycleBooking(input: {
  start: Date;
  status?: "PENDENTE" | "CONFIRMADO" | "CANCELADO";
  confirmationTokenExpiresAt?: Date | null;
  createdBy?: "CLIENT" | "BARBER";
}) {
  const barber = await prisma.barber.create({ data: { name: `Lifecycle Barber ${randomUUID()}` } });
  const service = await prisma.service.create({ data: { name: `Lifecycle Service ${randomUUID()}`, durationMinutes: 30, priceCents: 3000 } });
  return prisma.booking.create({ data: {
    barberId: barber.id, serviceId: service.id, customerName: "Lifecycle Client", customerPhone: "(69) 99999-1234",
    dateTimeStart: input.start, dateTimeEnd: new Date(input.start.getTime() + 30 * 60_000),
    status: input.status ?? "PENDENTE", createdBy: input.createdBy ?? "BARBER",
    ...(input.confirmationTokenExpiresAt !== undefined ? {
      confirmationTokenHash: hashPasswordResetToken(randomUUID()),
      confirmationTokenExpiresAt: input.confirmationTokenExpiresAt,
    } : {}),
  } });
}

async function enqueueFor(bookingId: string, event: "BOOKING_REMINDER" | "BOOKING_CREATED_BY_STAFF" | "BOOKING_CANCELLED") {
  await prisma.$transaction((tx) => enqueueBookingNotification(tx, { bookingId, event, audience: "CLIENT" }));
  return prisma.notificationDelivery.findFirstOrThrow({ where: { bookingId, event } });
}

function recordingSend() {
  const calls: string[] = [];
  const send = async (input: { idempotencyKey: string }) => {
    calls.push(input.idempotencyKey);
    return { ok: true as const, providerMessageId: `provider:${input.idempotencyKey}` };
  };
  return { calls, send };
}

async function enqueueReset(key: string) {
  await enqueueWhatsAppNotification(prisma, {
    event: "PASSWORD_RESET", to: "(69) 99999-1234", message: "Teste", context: "lifecycle", idempotencyKey: key,
  });
  return prisma.notificationDelivery.findUniqueOrThrow({ where: { idempotencyKey: key } });
}

test("lifecycle: expired and consumed password resets are retired without calling the provider", { skip: !disposable }, async () => {
  const expired = await enqueueReset(await createResetTokenKey({ expiresAt: new Date(Date.now() - 60_000) }));
  const used = await enqueueReset(await createResetTokenKey({ usedAt: new Date() }));
  const unverifiable = await enqueueReset(`password-reset-legacy:${randomUUID()}`);
  const valid = await enqueueReset(await createResetTokenKey());
  const { calls, send } = recordingSend();
  const summary = await withWhatsApp(true, () => processNotificationBatch({ workerId: "lifecycle-reset", batchSize: 10, send }));

  assert.deepEqual(calls, [valid.idempotencyKey]);
  assert.equal(summary.sent, 1);
  assert.equal(summary.expired, 3);
  for (const [row, category, reason] of [
    [expired, "lifecycle_expired", "reset_token_expired"],
    [used, "lifecycle_expired", "reset_token_used"],
    [unverifiable, "lifecycle_invalid_reference", "reset_reference_missing"],
  ] as const) {
    const after = await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(after.status, "DEAD");
    assert.equal(after.eligibleAt, null);
    assert.equal(after.nextRetryAt, null);
    assert.equal(after.lockedBy, null);
    assert.ok(after.processedAt);
    assert.equal(after.errorCategory, category);
    assert.equal(after.lastError, `Notification no longer valid: ${reason}`);
    assert.equal(after.providerMessageId, null);
  }
});

test("lifecycle: reminders for past, cancelled or rescheduled bookings are never sent; a future reminder is", { skip: !disposable }, async () => {
  const future = await createLifecycleBooking({ start: new Date(Date.now() + 24 * 60 * 60_000) });
  const validReminder = await enqueueFor(future.id, "BOOKING_REMINDER");

  const past = await createLifecycleBooking({ start: new Date(Date.now() + 24 * 60 * 60_000) });
  const pastReminder = await enqueueFor(past.id, "BOOKING_REMINDER");
  await prisma.booking.update({ where: { id: past.id }, data: { dateTimeStart: new Date(Date.now() - 60 * 60_000) } });

  const cancelled = await createLifecycleBooking({ start: new Date(Date.now() + 24 * 60 * 60_000) });
  const cancelledReminder = await enqueueFor(cancelled.id, "BOOKING_REMINDER");
  await prisma.booking.update({ where: { id: cancelled.id }, data: { status: "CANCELADO" } });

  const moved = await createLifecycleBooking({ start: new Date(Date.now() + 24 * 60 * 60_000) });
  const movedReminder = await enqueueFor(moved.id, "BOOKING_REMINDER");
  await prisma.booking.update({ where: { id: moved.id }, data: { dateTimeStart: new Date(Date.now() + 48 * 60 * 60_000) } });

  const { calls, send } = recordingSend();
  const summary = await withWhatsApp(true, () => processNotificationBatch({ workerId: "lifecycle-reminder", batchSize: 10, send }));
  assert.deepEqual(calls, [validReminder.idempotencyKey]);
  assert.equal(summary.expired, 3);
  const categoryOf = async (id: string) => (await prisma.notificationDelivery.findUniqueOrThrow({ where: { id } })).errorCategory;
  assert.equal(await categoryOf(pastReminder.id), "lifecycle_expired");
  assert.equal(await categoryOf(cancelledReminder.id), "lifecycle_canceled");
  assert.equal(await categoryOf(movedReminder.id), "lifecycle_invalid_reference");
});

test("lifecycle: creation notices honour the 6h window, the booking state and the confirmation link", { skip: !disposable }, async () => {
  const hour = 60 * 60_000;
  const future = () => new Date(Date.now() + 5 * 24 * hour);
  const ageNotice = (id: string, hours: number) =>
    prisma.notificationDelivery.update({ where: { id }, data: { createdAt: new Date(Date.now() - hours * hour) } });

  const fiveHours = await createLifecycleBooking({ start: future(), confirmationTokenExpiresAt: new Date(Date.now() + 43 * hour) });
  const fiveHoursNotice = await enqueueFor(fiveHours.id, "BOOKING_CREATED_BY_STAFF");
  await ageNotice(fiveHoursNotice.id, 5);

  const sevenHours = await createLifecycleBooking({ start: future() });
  const sevenHoursNotice = await enqueueFor(sevenHours.id, "BOOKING_CREATED_BY_STAFF");
  await ageNotice(sevenHoursNotice.id, 7);

  const expiredLink = await createLifecycleBooking({ start: future(), confirmationTokenExpiresAt: new Date(Date.now() - 1_000) });
  const expiredLinkNotice = await enqueueFor(expiredLink.id, "BOOKING_CREATED_BY_STAFF");

  const cancelled = await createLifecycleBooking({ start: future() });
  const cancelledNotice = await enqueueFor(cancelled.id, "BOOKING_CREATED_BY_STAFF");
  await prisma.booking.update({ where: { id: cancelled.id }, data: { status: "CANCELADO" } });

  const { calls, send } = recordingSend();
  const summary = await withWhatsApp(true, () => processNotificationBatch({ workerId: "lifecycle-staff", batchSize: 10, send }));
  assert.deepEqual(calls, [fiveHoursNotice.idempotencyKey]);
  assert.equal(summary.expired, 3);
  const stateOf = async (id: string) => {
    const row = await prisma.notificationDelivery.findUniqueOrThrow({ where: { id } });
    return [row.status, row.errorCategory, row.lastError];
  };
  assert.deepEqual(await stateOf(sevenHoursNotice.id), ["DEAD", "lifecycle_expired", "Notification no longer valid: notice_too_old"]);
  assert.deepEqual(await stateOf(expiredLinkNotice.id), ["DEAD", "lifecycle_expired", "Notification no longer valid: confirmation_token_expired"]);
  assert.deepEqual(await stateOf(cancelledNotice.id), ["DEAD", "lifecycle_canceled", "Notification no longer valid: booking_cancelled"]);
  // The 48h confirmation token TTL itself is untouched by the notice window.
  const linked = await prisma.booking.findUniqueOrThrow({ where: { id: fiveHours.id } });
  assert.ok(linked.confirmationTokenExpiresAt && linked.confirmationTokenExpiresAt > new Date(Date.now() + 42 * hour));
});

test("lifecycle: a booking cancelled between claim and send is not delivered", { skip: !disposable }, async () => {
  const booking = await createLifecycleBooking({ start: new Date(Date.now() + 24 * 60 * 60_000) });
  const reminder = await enqueueFor(booking.id, "BOOKING_REMINDER");
  const { calls, send } = recordingSend();
  await withWhatsApp(true, () => processNotificationBatch({
    workerId: "lifecycle-race", batchSize: 1, send,
    validate: async (item, now) => {
      // The row is already claimed (PROCESSING) when the booking changes.
      assert.equal((await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: item.id } })).status, "PROCESSING");
      await prisma.booking.update({ where: { id: booking.id }, data: { status: "CANCELADO" } });
      return checkNotificationValidity(prisma, item, now);
    },
  }));
  assert.equal(calls.length, 0);
  const after = await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: reminder.id } });
  assert.equal(after.status, "DEAD");
  assert.equal(after.errorCategory, "lifecycle_canceled");
});

// A client whose database is unreachable: exercises the real lookup failure path.
function unreachableDatabase() {
  return new PrismaClient({ datasourceUrl: "postgresql://postgres:unreachable@127.0.0.1:1/unreachable?connect_timeout=2" });
}

const failingValidate = async (): Promise<NotificationValidity> => { throw new Error("transient validation failure"); };

test("lifecycle: a transient error during validation defers without sending and keeps eligibility", { skip: !disposable }, async () => {
  const row = await enqueueReset(await createResetTokenKey());
  const { calls, send } = recordingSend();
  const summary = await withWhatsApp(true, () => processNotificationBatch({
    workerId: "lifecycle-check-failure", batchSize: 1, send, random: () => 0, validate: failingValidate,
  }));
  assert.equal(calls.length, 0);
  assert.equal(summary.retry, 1);
  assert.equal(summary.expired, 0);
  const after = await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: row.id } });
  assert.equal(after.status, "RETRY");
  assert.equal(after.attempts, 1);
  assert.equal(after.errorCategory, "lifecycle_unverifiable");
  assert.equal(after.lastError, "Notification validity temporarily unverifiable: validity_check_failed");
  assert.ok(after.eligibleAt);
  assert.ok(after.nextRetryAt && after.nextRetryAt > new Date());
  assert.equal(after.lockedBy, null);
  assert.equal(after.processedAt, null);
});

test("lifecycle: an unavailable database defers the delivery, which is sent after recovery", { skip: !disposable }, async () => {
  const booking = await createLifecycleBooking({ start: new Date(Date.now() + 24 * 60 * 60_000) });
  const reminder = await enqueueFor(booking.id, "BOOKING_REMINDER");
  const down = unreachableDatabase();
  const { calls, send } = recordingSend();
  try {
    await withWhatsApp(true, () => processNotificationBatch({
      workerId: "lifecycle-db-down", batchSize: 1, send, random: () => 0,
      validate: (item, now) => checkNotificationValidity(down, item, now),
    }));
  } finally {
    await down.$disconnect();
  }
  assert.equal(calls.length, 0);
  const deferred = await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: reminder.id } });
  assert.equal(deferred.status, "RETRY");
  assert.equal(deferred.errorCategory, "lifecycle_unverifiable");
  assert.equal(deferred.lastError, "Notification validity temporarily unverifiable: validity_lookup_failed");

  // Recovery: backoff elapses and the real database answers again.
  await prisma.notificationDelivery.update({ where: { id: reminder.id }, data: { nextRetryAt: new Date(Date.now() - 1_000) } });
  await withWhatsApp(true, () => processNotificationBatch({ workerId: "lifecycle-db-recovered", batchSize: 1, send }));
  assert.deepEqual(calls, [reminder.idempotencyKey]);
  const sent = await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: reminder.id } });
  assert.equal(sent.status, "SENT");
  assert.equal(sent.attempts, 2);
});

test("lifecycle: a deferred delivery that expired meanwhile is retired on its next attempt", { skip: !disposable }, async () => {
  const booking = await createLifecycleBooking({ start: new Date(Date.now() + 24 * 60 * 60_000) });
  const reminder = await enqueueFor(booking.id, "BOOKING_REMINDER");
  const { calls, send } = recordingSend();
  await withWhatsApp(true, () => processNotificationBatch({
    workerId: "lifecycle-defer", batchSize: 1, send, random: () => 0, validate: failingValidate,
  }));
  assert.equal((await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: reminder.id } })).status, "RETRY");

  await prisma.booking.update({ where: { id: booking.id }, data: { dateTimeStart: new Date(Date.now() - 60_000) } });
  await prisma.notificationDelivery.update({ where: { id: reminder.id }, data: { nextRetryAt: new Date(Date.now() - 1_000) } });
  await withWhatsApp(true, () => processNotificationBatch({ workerId: "lifecycle-defer-expired", batchSize: 1, send }));
  assert.equal(calls.length, 0);
  const after = await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: reminder.id } });
  assert.equal(after.status, "DEAD");
  assert.equal(after.errorCategory, "lifecycle_expired");
  assert.equal(after.lastError, "Notification no longer valid: booking_started");
});

test("lifecycle: an unverifiable delivery is never retried past its maximum validity", { skip: !disposable }, async () => {
  // Reminder cutoff is 60 minutes before start: 10s of validity left, backoff is 30s.
  const booking = await createLifecycleBooking({ start: new Date(Date.now() + 60 * 60_000 + 10_000) });
  const reminder = await enqueueFor(booking.id, "BOOKING_REMINDER");
  const { calls, send } = recordingSend();
  await withWhatsApp(true, () => processNotificationBatch({
    workerId: "lifecycle-defer-bound", batchSize: 1, send, random: () => 0, validate: failingValidate,
  }));
  assert.equal(calls.length, 0);
  const after = await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: reminder.id } });
  assert.equal(after.status, "DEAD");
  assert.equal(after.eligibleAt, null);
  assert.equal(after.errorCategory, "lifecycle_expired");
  assert.equal(after.lastError, "Notification no longer valid: unverifiable_until_expiry:validity_check_failed");
});

test("lifecycle: persistent unverifiability is bounded by the attempt limit", { skip: !disposable }, async () => {
  const previousMax = process.env.NOTIFICATION_MAX_ATTEMPTS;
  process.env.NOTIFICATION_MAX_ATTEMPTS = "2";
  try {
    const booking = await createLifecycleBooking({ start: new Date(Date.now() + 24 * 60 * 60_000) });
    const reminder = await enqueueFor(booking.id, "BOOKING_REMINDER");
    const { calls, send } = recordingSend();
    for (let round = 0; round < 3; round += 1) {
      await prisma.notificationDelivery.updateMany({ where: { id: reminder.id, status: "RETRY" }, data: { nextRetryAt: new Date(Date.now() - 1_000) } });
      await withWhatsApp(true, () => processNotificationBatch({
        workerId: `lifecycle-exhaust-${round}`, batchSize: 1, send, random: () => 0, validate: failingValidate,
      }));
    }
    assert.equal(calls.length, 0);
    const after = await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: reminder.id } });
    assert.equal(after.status, "DEAD");
    assert.equal(after.attempts, 2);
    assert.equal(after.eligibleAt, null);
    assert.equal(after.errorCategory, "lifecycle_unverifiable_exhausted");
  } finally {
    if (previousMax === undefined) delete process.env.NOTIFICATION_MAX_ATTEMPTS;
    else process.env.NOTIFICATION_MAX_ATTEMPTS = previousMax;
  }
});

test("lifecycle: concurrent workers defer unverifiable rows once each, under their own lease", { skip: !disposable }, async () => {
  const ids: string[] = [];
  for (let index = 0; index < 8; index += 1) ids.push((await enqueueReset(await createResetTokenKey())).id);
  const { calls, send } = recordingSend();
  const summaries = await withWhatsApp(true, () => Promise.all([
    processNotificationBatch({ workerId: "lifecycle-defer-a", batchSize: 8, send, random: () => 0, validate: failingValidate }),
    processNotificationBatch({ workerId: "lifecycle-defer-b", batchSize: 8, send, random: () => 0, validate: failingValidate }),
  ]));
  assert.equal(calls.length, 0);
  assert.equal(summaries.reduce((sum, item) => sum + item.claimed, 0), 8);
  assert.equal(summaries.reduce((sum, item) => sum + item.retry, 0), 8);
  const rows = await prisma.notificationDelivery.findMany({ where: { id: { in: ids } } });
  assert.ok(rows.every((row) => row.status === "RETRY" && row.attempts === 1 && row.lockedBy === null && row.eligibleAt));
});

test("lifecycle: a deferral does not overwrite a row whose lease was taken over", { skip: !disposable }, async () => {
  const row = await enqueueReset(await createResetTokenKey());
  const { send } = recordingSend();
  await withWhatsApp(true, () => processNotificationBatch({
    workerId: "lifecycle-lease-a", batchSize: 1, send,
    validate: async (item) => {
      // Another worker recovers the lock before this one settles.
      await prisma.notificationDelivery.update({ where: { id: item.id }, data: { lockedBy: "lifecycle-lease-b" } });
      throw new Error("transient validation failure");
    },
  }));
  const after = await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: row.id } });
  assert.equal(after.status, "PROCESSING");
  assert.equal(after.lockedBy, "lifecycle-lease-b");
  assert.equal(after.errorCategory, null);
});

test("lifecycle: an unreachable database is reported as unverifiable, never as invalid or valid", { skip: !disposable }, async () => {
  const dead = await prisma.notificationDelivery.create({ data: {
    event: "PASSWORD_RESET", recipient: "+5569999991234", recipientMasked: "*********1234",
    message: "Teste", context: "lifecycle-replay-unverifiable", idempotencyKey: await createResetTokenKey(),
    status: "DEAD", attempts: 1, errorCategory: "timeout", processedAt: new Date(),
  } });
  const down = unreachableDatabase();
  try {
    assert.deepEqual(await checkNotificationValidity(down, dead, new Date()), {
      outcome: "TEMPORARILY_UNVERIFIABLE", reason: "validity_lookup_failed",
    });
  } finally {
    await down.$disconnect();
  }
  assert.equal((await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: dead.id } })).status, "DEAD");
});

test("lifecycle: a retry that would land after the validity deadline becomes DEAD instead of RETRY", { skip: !disposable }, async () => {
  // Default reminder cutoff is 60 minutes before start; leave 10s of validity.
  const booking = await createLifecycleBooking({ start: new Date(Date.now() + 60 * 60_000 + 10_000) });
  const reminder = await enqueueFor(booking.id, "BOOKING_REMINDER");
  await withWhatsApp(true, () => processNotificationBatch({
    workerId: "lifecycle-retry-expiry", batchSize: 1, random: () => 0,
    send: async () => ({ ok: false, retryable: true, category: "network", error: "network" }),
  }));
  const after = await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: reminder.id } });
  assert.equal(after.status, "DEAD");
  assert.equal(after.attempts, 1);
  assert.equal(after.eligibleAt, null);
  assert.equal(after.errorCategory, "lifecycle_expired");
  assert.equal(after.lastError, "Notification no longer valid: retry_after_expiry:network");
});

test("lifecycle: a retry still inside the validity window keeps retrying", { skip: !disposable }, async () => {
  const booking = await createLifecycleBooking({ start: new Date(Date.now() + 24 * 60 * 60_000) });
  const reminder = await enqueueFor(booking.id, "BOOKING_REMINDER");
  await withWhatsApp(true, () => processNotificationBatch({
    workerId: "lifecycle-retry-ok", batchSize: 1, random: () => 0,
    send: async () => ({ ok: false, retryable: true, category: "network", error: "network" }),
  }));
  const after = await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: reminder.id } });
  assert.equal(after.status, "RETRY");
  assert.ok(after.eligibleAt);
});

test("lifecycle: replay refuses DEAD notifications that are no longer valid", { skip: !disposable }, async () => {
  const key = await createResetTokenKey({ expiresAt: new Date(Date.now() - 60_000) });
  const dead = await prisma.notificationDelivery.create({ data: {
    event: "PASSWORD_RESET", recipient: "+5569999991234", recipientMasked: "*********1234",
    message: "Teste", context: "lifecycle-replay", idempotencyKey: key,
    status: "DEAD", attempts: 1, errorCategory: "lifecycle_expired", processedAt: new Date(),
  } });
  const requestId = `lifecycle-replay-${randomUUID()}`;
  assert.deepEqual(await replayDeadNotification({
    notificationId: dead.id, actorId: "integration-admin", requestId, reason: "must_be_rejected",
  }), { ok: false, reason: "no_longer_valid" });
  const after = await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: dead.id } });
  assert.equal(after.status, "DEAD");
  assert.equal(after.eligibleAt, null);
  assert.equal(after.replayCount, 0);
  assert.equal(await prisma.auditLog.count({ where: { requestId } }), 0);
});

test("lifecycle: concurrent workers never deliver invalid rows and process each row once", { skip: !disposable }, async () => {
  const keys = { valid: [] as string[], invalid: [] as string[] };
  for (let index = 0; index < 6; index += 1) {
    keys.valid.push((await enqueueReset(await createResetTokenKey())).idempotencyKey);
    keys.invalid.push((await enqueueReset(await createResetTokenKey({ expiresAt: new Date(Date.now() - 1_000) }))).idempotencyKey);
  }
  const { calls, send } = recordingSend();
  const summaries = await withWhatsApp(true, () => Promise.all([
    processNotificationBatch({ workerId: "lifecycle-a", batchSize: 12, send }),
    processNotificationBatch({ workerId: "lifecycle-b", batchSize: 12, send }),
  ]));
  assert.deepEqual([...calls].sort(), [...keys.valid].sort());
  assert.equal(summaries.reduce((sum, item) => sum + item.claimed, 0), 12);
  assert.equal(summaries.reduce((sum, item) => sum + item.expired, 0), 6);
  assert.equal(await prisma.notificationDelivery.count({ where: { status: "SENT" } }), 6);
  assert.equal(await prisma.notificationDelivery.count({ where: { status: "DEAD", errorCategory: "lifecycle_expired" } }), 6);
});

test("lifecycle: a disabled worker claims nothing, sends nothing and leaves rows untouched", { skip: !disposable }, async () => {
  const row = await enqueueReset(await createResetTokenKey({ expiresAt: new Date(Date.now() - 60_000) }));
  let sendCalls = 0;
  const summary = await withWhatsApp(false, () => processNotificationBatch({
    workerId: "lifecycle-disabled", batchSize: 10,
    send: async () => { sendCalls += 1; return { ok: true }; },
  }));
  assert.equal(sendCalls, 0);
  assert.equal(summary.claimed, 0);
  assert.equal(summary.sent, 0);
  assert.equal(summary.expired, 0);
  const after = await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: row.id } });
  assert.equal(after.status, "PENDING");
  assert.equal(after.attempts, 0);
});

test("lifecycle: reminders are not generated while WhatsApp is disabled", { skip: !disposable }, async () => {
  const now = new Date();
  const booking = await createLifecycleBooking({ start: new Date(now.getTime() + 24 * 60 * 60_000) });
  assert.equal(await withWhatsApp(false, () => enqueueDueBookingReminders(now)), 0);
  assert.equal(await prisma.notificationDelivery.count({ where: { bookingId: booking.id, event: "BOOKING_REMINDER" } }), 0);

  const enqueued = await withWhatsApp(true, () => enqueueDueBookingReminders(now));
  assert.ok(enqueued >= 1);
  const reminder = await prisma.notificationDelivery.findFirstOrThrow({ where: { bookingId: booking.id, event: "BOOKING_REMINDER" } });
  assert.equal((await checkNotificationValidity(prisma, reminder, now)).outcome, "VALID");
});
