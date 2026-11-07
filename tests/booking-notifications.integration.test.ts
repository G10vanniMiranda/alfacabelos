import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { prisma } from "../lib/prisma";
import { cancelBookingSeries, createBookingSeriesAtomic, updateBookingSeriesOccurrences } from "../lib/booking-series-service";
import { enqueueBookingNotification, enqueueDueBookingReminders } from "../lib/notifications/booking-intents";
import { deliverPendingBookingNotifications, processNotificationBatch } from "../lib/notifications/service";
import { bookingAudienceFromKey } from "../lib/notifications/validity-policy";
import { prismaRepository } from "../lib/repositories/prisma";
import { zonedDateTimeToUtcIso } from "../lib/utils";

// Disposable local database only; synthetic numbers (DDD 20 is not assigned in Brazil).
const databaseUrl = process.env.DATABASE_URL ?? "";
const disposable = process.env.RUN_DATABASE_TESTS === "true" && /localhost|127\.0\.0\.1/.test(databaseUrl);
const OWNER = "(20) 90000-0001";
const CLIENT = "(20) 90000-0031";
const OWNER_E164 = "5520900000001";
const CLIENT_E164 = "5520900000031";
const TZ = "America/Porto_Velho";

process.env.WHATSAPP_OWNER_PHONE = OWNER;
delete process.env.WHATSAPP_PROVIDER;

async function fixture() {
  const barber = await prisma.barber.create({ data: { name: `[QA] Barbeiro Notif ${randomUUID().slice(0, 8)}` } });
  const service = await prisma.service.create({ data: { name: "[QA] Corte Notif", durationMinutes: 30, priceCents: 1000 } });
  await prisma.barberAvailability.createMany({
    data: Array.from({ length: 7 }, (_, dayOfWeek) => ({ barberId: barber.id, dayOfWeek, openTime: "08:00", closeTime: "20:00" })),
  });
  const cleanup = async () => {
    const bookings = await prisma.booking.findMany({ where: { barberId: barber.id }, select: { id: true } });
    await prisma.notificationDelivery.deleteMany({ where: { bookingId: { in: bookings.map((item) => item.id) } } });
    await prisma.booking.deleteMany({ where: { barberId: barber.id } });
    await prisma.bookingSeries.deleteMany({ where: { barberId: barber.id } });
    await prisma.barberAvailability.deleteMany({ where: { barberId: barber.id } });
    await prisma.service.delete({ where: { id: service.id } });
    await prisma.barber.delete({ where: { id: barber.id } });
  };
  return { barber, service, cleanup };
}

const slot = (localDate: string, time = "09:00") => zonedDateTimeToUtcIso(localDate, `${time}:00`, TZ);

function bookingInput(f: Awaited<ReturnType<typeof fixture>>, localDate: string, extra: Partial<Parameters<typeof createBookingSeriesAtomic>[0]> = {}) {
  return {
    serviceId: f.service.id, barberId: f.barber.id, customerName: "[QA] Cliente Notif", customerPhone: CLIENT,
    start: slot(localDate), recurrence: "NONE" as const, idempotencyKey: randomUUID(), createdBy: "CLIENT" as const,
    requestId: `req-${randomUUID()}`, ...extra,
  };
}

async function rowsFor(bookingId: string, event?: string) {
  return prisma.notificationDelivery.findMany({ where: { bookingId, ...(event ? { event: event as never } : {}) }, orderBy: { idempotencyKey: "asc" } });
}

const audiences = (rows: Array<{ idempotencyKey: string }>) => rows.map((row) => bookingAudienceFromKey(row.idempotencyKey)).sort();

async function withWhatsApp<T>(run: () => Promise<T>): Promise<T> {
  const previous = process.env.WHATSAPP_ENABLED;
  process.env.WHATSAPP_ENABLED = "true";
  try { return await run(); } finally {
    if (previous === undefined) delete process.env.WHATSAPP_ENABLED;
    else process.env.WHATSAPP_ENABLED = previous;
  }
}

test("cliente agenda: responsável e cliente recebem, uma linha cada", { skip: !disposable }, async () => {
  const f = await fixture();
  try {
    const input = bookingInput(f, "2037-05-04");
    const created = await createBookingSeriesAtomic(input);
    const rows = await rowsFor(created.bookingIds[0]!);
    assert.deepEqual(audiences(rows), ["CLIENT", "OWNER"]);
    assert.deepEqual(rows.map((row) => row.recipient).sort(), [CLIENT_E164, OWNER_E164].sort());
    assert.ok(rows.every((row) => row.status === "PENDING" && row.requestId === input.requestId && row.event === "BOOKING_CREATED_BY_CLIENT"));
  } finally { await f.cleanup(); }
});

test("equipe agenda: dois destinatários e o link de confirmação só para o cliente", { skip: !disposable }, async () => {
  const f = await fixture();
  try {
    const created = await createBookingSeriesAtomic(bookingInput(f, "2037-05-05", { createdBy: "BARBER", requireConfirmation: true }));
    const rows = await rowsFor(created.bookingIds[0]!);
    const owner = rows.find((row) => bookingAudienceFromKey(row.idempotencyKey) === "OWNER")!;
    const client = rows.find((row) => bookingAudienceFromKey(row.idempotencyKey) === "CLIENT")!;
    assert.equal(rows.length, 2);
    assert.match(client.message, /confirmar-agendamento\?token=/);
    assert.doesNotMatch(owner.message, /confirmar-agendamento|token=/);
  } finally { await f.cleanup(); }
});

test("cancelamento: os dois são avisados, e cancelamentos concorrentes não duplicam", { skip: !disposable }, async () => {
  const f = await fixture();
  try {
    const created = await createBookingSeriesAtomic(bookingInput(f, "2037-05-06"));
    const bookingId = created.bookingIds[0]!;
    const results = await Promise.allSettled([
      cancelBookingSeries({ bookingId, scope: "SINGLE", cancelledBy: "CLIENT", requestId: `req-${randomUUID()}` }),
      cancelBookingSeries({ bookingId, scope: "SINGLE", cancelledBy: "CLIENT", requestId: `req-${randomUUID()}` }),
    ]);
    assert.equal(results.filter((item) => item.status === "fulfilled").reduce((sum, item) => sum + (item.status === "fulfilled" ? item.value.count : 0), 0), 1);
    const rows = await rowsFor(bookingId, "BOOKING_CANCELLED");
    assert.deepEqual(audiences(rows), ["CLIENT", "OWNER"]);
    assert.match(rows.find((row) => bookingAudienceFromKey(row.idempotencyKey) === "OWNER")!.message, /Cancelado por: cliente/);
  } finally { await f.cleanup(); }
});

test("reagendamento pela equipe e pelo cliente: dois destinatários a cada vez, sem colisão de chaves", { skip: !disposable }, async () => {
  const f = await fixture();
  try {
    const created = await createBookingSeriesAtomic(bookingInput(f, "2037-05-07"));
    const bookingId = created.bookingIds[0]!;
    await updateBookingSeriesOccurrences({
      bookingId, scope: "SINGLE", serviceId: f.service.id, barberId: f.barber.id,
      customerName: "[QA] Cliente Notif", customerPhone: CLIENT, start: slot("2037-05-07", "10:00"), requestId: `req-${randomUUID()}`,
    });
    assert.deepEqual(audiences(await rowsFor(bookingId, "BOOKING_RESCHEDULED")), ["CLIENT", "OWNER"]);
    const start = slot("2037-05-07", "11:00");
    await prismaRepository.updateBooking({
      bookingId, serviceId: f.service.id, barberId: f.barber.id, customerName: "[QA] Cliente Notif", customerPhone: CLIENT,
      dateTimeStart: start, dateTimeEnd: new Date(new Date(start).getTime() + 30 * 60_000).toISOString(),
      notification: { event: "BOOKING_RESCHEDULED", actor: "CLIENT", requestId: `req-${randomUUID()}` },
    });
    const rows = await rowsFor(bookingId, "BOOKING_RESCHEDULED");
    assert.equal(rows.length, 4);
    assert.equal(new Set(rows.map((row) => row.idempotencyKey)).size, 4);
    assert.ok(rows.some((row) => /Remarcado por: cliente/.test(row.message)));
  } finally { await f.cleanup(); }
});

test("idempotência e concorrência na criação: nenhum agendamento ou aviso duplicado", { skip: !disposable }, async () => {
  const f = await fixture();
  try {
    // Series: the idempotency key is stored, so concurrent and repeated requests collapse onto one series.
    const series = bookingInput(f, "2037-05-08", { recurrence: "DAILY", repeatUntil: "2037-05-09" });
    const settled = await Promise.allSettled([createBookingSeriesAtomic(series), createBookingSeriesAtomic(series)]);
    // Pre-existing contract: the loser of a serialization race returns the duplicate or fails
    // cleanly asking to retry; it never creates a second booking or second notices.
    for (const item of settled) {
      if (item.status === "rejected") assert.match(String(item.reason), /A agenda mudou durante a reserva/);
    }
    const replay = await createBookingSeriesAtomic(series);
    assert.equal(replay.duplicate, true);
    assert.equal(replay.bookingIds.length, 2);
    // One consolidated notice per audience for the whole series, anchored on the first occurrence.
    assert.deepEqual(audiences(await prisma.notificationDelivery.findMany({ where: { seriesId: replay.seriesId } })), ["CLIENT", "OWNER"]);

    // Single booking: no series row, so a repeat is refused by the slot conflict, again without duplicates.
    const single = bookingInput(f, "2037-05-15");
    const first = await createBookingSeriesAtomic(single);
    await assert.rejects(createBookingSeriesAtomic(single), /Conflito com agendamento existente/);
    assert.equal(await prisma.booking.count({ where: { barberId: f.barber.id } }), 3);
    assert.equal((await rowsFor(first.bookingIds[0]!)).length, 2);
  } finally { await f.cleanup(); }
});

test("nada é enviado antes do commit: rollback não deixa aviso nem dispara envio", { skip: !disposable }, async () => {
  const f = await fixture();
  const requestId = `req-${randomUUID()}`;
  const calls: string[] = [];
  try {
    await assert.rejects(prisma.$transaction(async (tx) => {
      const booking = await tx.booking.create({ data: {
        barberId: f.barber.id, serviceId: f.service.id, customerName: "[QA] Cliente Notif", customerPhone: CLIENT,
        dateTimeStart: new Date(slot("2037-05-09")), dateTimeEnd: new Date(new Date(slot("2037-05-09")).getTime() + 30 * 60_000),
      } });
      await enqueueBookingNotification(tx, { bookingId: booking.id, event: "BOOKING_CREATED_BY_CLIENT", requestId });
      throw new Error("forced rollback");
    }), /forced rollback/);
    assert.equal(await prisma.notificationDelivery.count({ where: { requestId } }), 0);
    const outcomes = await withWhatsApp(() => deliverPendingBookingNotifications(requestId, { send: async (input) => { calls.push(input.to); return { ok: true }; } }));
    assert.deepEqual(outcomes, []);
    assert.deepEqual(calls, []);
  } finally { await f.cleanup(); }
});

test("falha parcial: um destinatário falha, o outro recebe; o retry entrega depois sem reenviar", { skip: !disposable }, async () => {
  const f = await fixture();
  try {
    const input = bookingInput(f, "2037-05-10");
    const created = await createBookingSeriesAtomic(input);
    const calls: string[] = [];
    const outcomes = await withWhatsApp(() => deliverPendingBookingNotifications(input.requestId!, {
      random: () => 0,
      send: async (message) => {
        calls.push(message.to);
        return message.to === OWNER_E164
          ? { ok: false, retryable: true, category: "provider_transient", error: "HTTP 503" }
          : { ok: true, providerMessageId: "fake-client" };
      },
    }));
    assert.deepEqual([...outcomes].sort(), ["retry", "sent"]);
    const rows = await rowsFor(created.bookingIds[0]!);
    const owner = rows.find((row) => row.recipient === OWNER_E164)!;
    assert.equal(owner.status, "RETRY");
    assert.equal(rows.find((row) => row.recipient === CLIENT_E164)!.status, "SENT");
    assert.equal(await prisma.booking.count({ where: { id: created.bookingIds[0]!, status: "PENDENTE" } }), 1, "agendamento intacto");

    // The worker claims the oldest eligible rows first: leftovers from other suites in this
    // disposable database must not crowd the batch (same reset the outbox suite does).
    await prisma.notificationDelivery.deleteMany({ where: { NOT: { bookingId: created.bookingIds[0]! } } });
    const retried: string[] = [];
    await withWhatsApp(() => processNotificationBatch({
      workerId: "retry-test", batchSize: 10, now: new Date(owner.nextRetryAt!.getTime() + 1_000),
      send: async (message) => { retried.push(message.to); return { ok: true, providerMessageId: "fake-owner" }; },
    }));
    assert.ok(retried.includes(OWNER_E164));
    assert.ok(!retried.includes(CLIENT_E164), "cliente não recebe de novo");
    assert.equal((await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: owner.id } })).status, "SENT");
  } finally { await f.cleanup(); }
});

test("provedor indisponível: avisos ficam em RETRY e o agendamento permanece", { skip: !disposable }, async () => {
  const f = await fixture();
  try {
    const input = bookingInput(f, "2037-05-11");
    const created = await createBookingSeriesAtomic(input);
    const outcomes = await withWhatsApp(() => deliverPendingBookingNotifications(input.requestId!, {
      send: async () => { throw new Error("connect ECONNREFUSED"); },
    }));
    assert.deepEqual(outcomes, ["retry", "retry"]);
    assert.equal(await prisma.booking.count({ where: { id: created.bookingIds[0]! } }), 1);
  } finally { await f.cleanup(); }
});

test("WhatsApp desabilitado: nada é enviado, avisos ficam duráveis em PENDING", { skip: !disposable }, async () => {
  const f = await fixture();
  try {
    const input = bookingInput(f, "2037-05-12");
    const created = await createBookingSeriesAtomic(input);
    const previous = process.env.WHATSAPP_ENABLED;
    delete process.env.WHATSAPP_ENABLED;
    try {
      assert.deepEqual(await deliverPendingBookingNotifications(input.requestId!, { send: async () => assert.fail("must not send") }), []);
    } finally { if (previous !== undefined) process.env.WHATSAPP_ENABLED = previous; }
    assert.ok((await rowsFor(created.bookingIds[0]!)).every((row) => row.status === "PENDING"));
  } finally { await f.cleanup(); }
});

test("telefone do cliente inválido: só o responsável é avisado", { skip: !disposable }, async () => {
  const f = await fixture();
  try {
    const booking = await prisma.booking.create({ data: {
      barberId: f.barber.id, serviceId: f.service.id, customerName: "[QA] Cliente Notif", customerPhone: "123",
      dateTimeStart: new Date(slot("2037-05-13")), dateTimeEnd: new Date(new Date(slot("2037-05-13")).getTime() + 30 * 60_000), status: "CANCELADO",
    } });
    await prisma.$transaction((tx) => enqueueBookingNotification(tx, { bookingId: booking.id, event: "BOOKING_CANCELLED", actor: "STAFF" }));
    assert.deepEqual(audiences(await rowsFor(booking.id)), ["OWNER"]);
  } finally { await f.cleanup(); }
});

const seriesInput = (f: Awaited<ReturnType<typeof fixture>>, from: string, until: string, extra: Partial<Parameters<typeof createBookingSeriesAtomic>[0]> = {}) =>
  bookingInput(f, from, { recurrence: "DAILY", repeatUntil: until, ...extra });

for (const [label, from, until, count] of [["poucas", "2037-06-01", "2037-06-03", 3], ["muitas", "2037-07-01", "2037-08-28", 59]] as const) {
  test(`série com ${label} ocorrências: um aviso consolidado por destinatário, replay sem duplicar`, { skip: !disposable }, async () => {
    const f = await fixture();
    try {
      const input = seriesInput(f, from, until);
      const created = await createBookingSeriesAtomic(input);
      assert.equal(created.bookingIds.length, count);
      const rows = await prisma.notificationDelivery.findMany({ where: { requestId: input.requestId } });
      assert.deepEqual(audiences(rows), ["CLIENT", "OWNER"]);
      assert.ok(rows.every((row) => row.seriesId === created.seriesId && row.idempotencyKey.startsWith(`series:${created.seriesId}:`)));
      assert.ok(rows.every((row) => new RegExp(`Horários: ${count}`).test(row.message)));
      const replay = await createBookingSeriesAtomic(input);
      assert.equal(replay.duplicate, true);
      assert.equal(await prisma.notificationDelivery.count({ where: { seriesId: created.seriesId } }), 2);
    } finally { await f.cleanup(); }
  });
}

test("série criada pela equipe: link do cliente confirma a primeira ocorrência", { skip: !disposable }, async () => {
  const f = await fixture();
  try {
    const created = await createBookingSeriesAtomic(seriesInput(f, "2037-09-01", "2037-09-03", { createdBy: "BARBER", requireConfirmation: true }));
    const client = await prisma.notificationDelivery.findFirstOrThrow({ where: { seriesId: created.seriesId, idempotencyKey: { contains: ":client:" } } });
    const token = new URL(/https?:\/\/\S+confirmar-agendamento\?token=\S+/.exec(client.message)![0]).searchParams.get("token")!;
    const { confirmBookingByToken } = await import("../lib/booking-service");
    const confirmed = await confirmBookingByToken(token);
    assert.equal(confirmed.id, created.bookingIds[0]);
    const owner = await prisma.notificationDelivery.findFirstOrThrow({ where: { seriesId: created.seriesId, idempotencyKey: { contains: ":owner:" } } });
    assert.doesNotMatch(owner.message, /token=/);
  } finally { await f.cleanup(); }
});

test("série: cancelamento de várias ocorrências consolida; de uma ocorrência só, aviso individual", { skip: !disposable }, async () => {
  const f = await fixture();
  try {
    const created = await createBookingSeriesAtomic(seriesInput(f, "2037-10-01", "2037-10-05"));
    const [firstId, secondId] = created.bookingIds;
    await cancelBookingSeries({ bookingId: firstId!, scope: "SINGLE", cancelledBy: "STAFF", requestId: `req-${randomUUID()}` });
    assert.deepEqual(audiences(await rowsFor(firstId!, "BOOKING_CANCELLED")), ["CLIENT", "OWNER"]);
    const futureRequest = `req-${randomUUID()}`;
    const result = await cancelBookingSeries({ bookingId: secondId!, scope: "FUTURE", cancelledBy: "CLIENT", requestId: futureRequest });
    assert.equal(result.count, 4);
    const rows = await prisma.notificationDelivery.findMany({ where: { requestId: futureRequest } });
    assert.deepEqual(audiences(rows), ["CLIENT", "OWNER"]);
    assert.ok(rows.every((row) => row.idempotencyKey.startsWith(`series:${created.seriesId}:`) && /Horários: 4/.test(row.message)));
    assert.equal(rows[0]!.bookingId, created.bookingIds[4], "âncora = última ocorrência cancelada");
    const { checkNotificationValidity } = await import("../lib/notifications/validity-policy");
    for (const row of rows) assert.equal((await checkNotificationValidity(prisma, row)).outcome, "VALID");
  } finally { await f.cleanup(); }
});

test("série: ocorrências já passadas ficam fora do aviso de cancelamento", { skip: !disposable }, async () => {
  const f = await fixture();
  try {
    const created = await createBookingSeriesAtomic(seriesInput(f, "2037-10-10", "2037-10-13"));
    // Two occurrences moved to the past (as happens for an old series being cancelled with scope ALL).
    for (const [index, daysAgo] of [[0, 3], [1, 2]] as const) {
      const start = new Date(Date.now() - daysAgo * 86_400_000);
      await prisma.booking.update({ where: { id: created.bookingIds[index]! }, data: { dateTimeStart: start, dateTimeEnd: new Date(start.getTime() + 30 * 60_000) } });
    }
    const requestId = `req-${randomUUID()}`;
    const result = await cancelBookingSeries({ bookingId: created.bookingIds[2]!, scope: "ALL", cancelledBy: "STAFF", requestId });
    assert.equal(result.count, 4);
    const rows = await prisma.notificationDelivery.findMany({ where: { requestId } });
    assert.deepEqual(audiences(rows), ["CLIENT", "OWNER"]);
    assert.ok(rows.every((row) => /Horários: 2/.test(row.message)), "só as 2 futuras");
  } finally { await f.cleanup(); }
});

test("série: reagendamento de todas as ocorrências consolida e continua válido", { skip: !disposable }, async () => {
  const f = await fixture();
  try {
    const created = await createBookingSeriesAtomic(seriesInput(f, "2037-11-02", "2037-11-04"));
    const requestId = `req-${randomUUID()}`;
    await updateBookingSeriesOccurrences({
      bookingId: created.bookingIds[0]!, scope: "ALL", serviceId: f.service.id, barberId: f.barber.id,
      customerName: "[QA] Cliente Notif", customerPhone: CLIENT, start: slot("2037-11-02", "15:00"), requestId,
    });
    const rows = await prisma.notificationDelivery.findMany({ where: { requestId } });
    assert.deepEqual(audiences(rows), ["CLIENT", "OWNER"]);
    assert.ok(rows.every((row) => /Novos horários: 3/.test(row.message)));
    const { checkNotificationValidity } = await import("../lib/notifications/validity-policy");
    for (const row of rows) assert.equal((await checkNotificationValidity(prisma, row)).outcome, "VALID");
  } finally { await f.cleanup(); }
});

test("provedor religado depois: só avisos recentes saem; os antigos morrem sem envio", { skip: !disposable }, async () => {
  const f = await fixture();
  try {
    const stale = bookingInput(f, "2037-12-01");
    const fresh = bookingInput(f, "2037-12-02");
    const staleBooking = await createBookingSeriesAtomic(stale);
    await cancelBookingSeries({ bookingId: staleBooking.bookingIds[0]!, scope: "SINGLE", cancelledBy: "CLIENT", requestId: stale.requestId });
    await createBookingSeriesAtomic(fresh);
    // Simulate a backlog kept while WhatsApp was off: the stale request's notices are 7 h old.
    await prisma.notificationDelivery.updateMany({ where: { requestId: stale.requestId }, data: { createdAt: new Date(Date.now() - 7 * 3_600_000) } });
    await prisma.notificationDelivery.deleteMany({ where: { requestId: { notIn: [stale.requestId!, fresh.requestId!] } } });
    const sent: string[] = [];
    const summary = await withWhatsApp(() => processNotificationBatch({
      workerId: "re-enable", batchSize: 20,
      send: async (message) => { sent.push(message.idempotencyKey); return { ok: true }; },
    }));
    assert.equal(summary.sent, 2, "apenas os 2 avisos recentes");
    assert.equal(summary.expired, 4, "criação + cancelamento antigos, dois públicos cada");
    assert.ok(sent.every((key) => !key.includes(staleBooking.bookingIds[0]!)));
    const dead = await prisma.notificationDelivery.findMany({ where: { requestId: stale.requestId } });
    // Cancel notices: too old. Creation notices of the now-cancelled booking: cancelled.
    assert.ok(dead.every((row) => row.status === "DEAD" && ["lifecycle_expired", "lifecycle_canceled"].includes(row.errorCategory ?? "")));
    assert.ok(dead.filter((row) => row.event === "BOOKING_CANCELLED").every((row) => row.errorCategory === "lifecycle_expired"));
  } finally { await f.cleanup(); }
});

test("entrega concorrente da mesma linha e retry posterior não duplicam o envio", { skip: !disposable }, async () => {
  const f = await fixture();
  try {
    const input = bookingInput(f, "2037-12-03");
    await createBookingSeriesAtomic(input);
    const calls: string[] = [];
    const send = async (message: { to: string }) => { calls.push(message.to); return { ok: true as const }; };
    await withWhatsApp(() => Promise.all([
      deliverPendingBookingNotifications(input.requestId!, { send }),
      deliverPendingBookingNotifications(input.requestId!, { send }),
    ]));
    assert.deepEqual([...calls].sort(), [CLIENT_E164, OWNER_E164].sort(), "cada destinatário uma única vez");
    await withWhatsApp(() => deliverPendingBookingNotifications(input.requestId!, { send }));
    await withWhatsApp(() => processNotificationBatch({ workerId: "after-sent", batchSize: 20, send }));
    assert.equal(calls.length, 2);
  } finally { await f.cleanup(); }
});

test("regressão: lembretes continuam só para o cliente", { skip: !disposable }, async () => {
  const f = await fixture();
  try {
    const start = new Date(Date.now() + 24 * 60 * 60_000);
    const booking = await prisma.booking.create({ data: {
      barberId: f.barber.id, serviceId: f.service.id, customerName: "[QA] Cliente Notif", customerPhone: CLIENT,
      dateTimeStart: start, dateTimeEnd: new Date(start.getTime() + 30 * 60_000), status: "CONFIRMADO",
    } });
    await withWhatsApp(() => enqueueDueBookingReminders(new Date(), `req-${randomUUID()}`));
    assert.deepEqual(audiences(await rowsFor(booking.id, "BOOKING_REMINDER")), ["CLIENT"]);
  } finally { await f.cleanup(); }
});
