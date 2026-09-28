import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { beforeEach, test } from "node:test";
import { prisma } from "../lib/prisma";
import {
  claimNotificationBatch,
  enqueueWhatsAppNotification,
  processNotificationBatch,
} from "../lib/notifications/service";
import { createBookingSeriesAtomic } from "../lib/booking-series-service";
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

  const claimed = await claimNotificationBatch({ workerId: "eligibility-worker", batchSize: 10, now });
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
    processNotificationBatch({ workerId: "worker-a", batchSize: 12, send }),
    processNotificationBatch({ workerId: "worker-b", batchSize: 12, send }),
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
    workerId: "worker-retry", batchSize: 1, random: () => 0,
    send: async () => ({ ok: false, retryable: true, category: "network", error: "network" }),
  });
  const retry = await prisma.notificationDelivery.findUniqueOrThrow({ where: { idempotencyKey: key } });
  assert.equal(retry.status, "RETRY");
  assert.equal(retry.attempts, 1);
  assert.ok(retry.nextRetryAt);

  await prisma.notificationDelivery.update({ where: { id: retry.id }, data: { nextRetryAt: new Date(0) } });
  await processNotificationBatch({
    workerId: "worker-dead", batchSize: 1,
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
      workerId: "worker-exhausted", batchSize: 1,
      send: async () => ({ ok: false, retryable: true, category: "timeout", error: "timeout" }),
    });
    const delivery = await prisma.notificationDelivery.findUniqueOrThrow({ where: { idempotencyKey: key } });
    assert.equal(delivery.status, "DEAD");
    assert.equal(delivery.attempts, 1);
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
    message: "Teste", context: "replay-integration", idempotencyKey: `replay:${randomUUID()}`,
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
      context: "concurrent-replay", idempotencyKey: `concurrent-replay:${runId}`, status: "DEAD", attempts: 8, processedAt: new Date(),
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
