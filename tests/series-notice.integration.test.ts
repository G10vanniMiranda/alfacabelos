import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { prisma } from "../lib/prisma";
import { cancelBookingSeries, createBookingSeriesAtomic, updateBookingSeriesOccurrences } from "../lib/booking-series-service";
import { confirmBookingByToken } from "../lib/booking-service";
import { deliverPendingBookingNotifications, processNotificationBatch } from "../lib/notifications/service";
import { bookingAudienceFromKey } from "../lib/notifications/validity-policy";
import { zonedDateTimeToUtcIso } from "../lib/utils";

// Disposable local database and fake provider only; synthetic numbers (DDD 20 is unassigned).
const databaseUrl = process.env.DATABASE_URL ?? "";
const disposable = process.env.RUN_DATABASE_TESTS === "true" && /localhost|127\.0\.0\.1/.test(databaseUrl);
const OWNER_E164 = "5520900000001";
const CLIENT_E164 = "5520900000031";
process.env.WHATSAPP_OWNER_PHONE = "(20) 90000-0001";
delete process.env.WHATSAPP_PROVIDER;
const TZ = "America/Porto_Velho";

async function fixture() {
  const barber = await prisma.barber.create({ data: { name: `[QA] Barbeiro Série ${randomUUID().slice(0, 8)}` } });
  const service = await prisma.service.create({ data: { name: "[QA] Corte Série", durationMinutes: 30, priceCents: 1000 } });
  await prisma.barberAvailability.createMany({
    data: Array.from({ length: 7 }, (_, dayOfWeek) => ({ barberId: barber.id, dayOfWeek, openTime: "08:00", closeTime: "20:00" })),
  });
  return {
    barber, service,
    async cleanup() {
      const bookings = await prisma.booking.findMany({ where: { barberId: barber.id }, select: { id: true, seriesId: true } });
      const seriesIds = [...new Set(bookings.flatMap((item) => (item.seriesId ? [item.seriesId] : [])))];
      await prisma.notificationDelivery.deleteMany({ where: { OR: [{ bookingId: { in: bookings.map((item) => item.id) } }, { seriesId: { in: seriesIds } }] } });
      await prisma.booking.deleteMany({ where: { barberId: barber.id } });
      await prisma.bookingSeries.deleteMany({ where: { barberId: barber.id } });
      await prisma.barberAvailability.deleteMany({ where: { barberId: barber.id } });
      await prisma.service.delete({ where: { id: service.id } });
      await prisma.barber.delete({ where: { id: barber.id } });
    },
  };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
const slot = (localDate: string, time = "09:00") => zonedDateTimeToUtcIso(localDate, `${time}:00`, TZ);
/** "2038-01-04" -> "04/01 às 09:00", as it appears on an occurrence line. */
const line = (localDate: string, time = "09:00") => `${localDate.slice(8, 10)}/${localDate.slice(5, 7)} às ${time}`;

async function createSeries(f: Fixture, from: string, until: string, staff = false) {
  const requestId = `req-${randomUUID()}`;
  const created = await createBookingSeriesAtomic({
    serviceId: f.service.id, barberId: f.barber.id, customerName: "[QA] Cliente Série", customerPhone: "(20) 90000-0031",
    start: slot(from), recurrence: "DAILY", repeatUntil: until, idempotencyKey: randomUUID(),
    createdBy: staff ? "BARBER" : "CLIENT", requireConfirmation: staff, requestId,
  });
  return { ...created, requestId };
}

async function withWhatsApp<T>(run: () => Promise<T>): Promise<T> {
  const previous = process.env.WHATSAPP_ENABLED;
  process.env.WHATSAPP_ENABLED = "true";
  try { return await run(); } finally {
    if (previous === undefined) delete process.env.WHATSAPP_ENABLED;
    else process.env.WHATSAPP_ENABLED = previous;
  }
}

function recorder(fail = false) {
  const sent = new Map<string, string[]>();
  const send = async (message: { to: string; message: string }) => {
    sent.set(message.to, [...(sent.get(message.to) ?? []), message.message]);
    return fail ? { ok: false as const, retryable: true, category: "provider_transient", error: "HTTP 503" } : { ok: true as const };
  };
  return { sent, send };
}

const creationRows = (seriesId: string) => prisma.notificationDelivery.findMany({
  where: { seriesId, event: { in: ["BOOKING_CREATED_BY_CLIENT", "BOOKING_CREATED_BY_STAFF"] } },
});

test("série de três: resumo atual com status de cada horário para os dois destinatários", { skip: !disposable }, async () => {
  const f = await fixture();
  try {
    const series = await createSeries(f, "2038-01-04", "2038-01-06");
    const { sent, send } = recorder();
    await withWhatsApp(() => deliverPendingBookingNotifications(series.requestId, { send }));
    for (const to of [OWNER_E164, CLIENT_E164]) {
      const [message] = sent.get(to)!;
      assert.match(message!, /Horários: 3/);
      assert.equal((message!.match(/— aguardando confirmação/g) ?? []).length, 3);
      for (const day of ["2038-01-04", "2038-01-05", "2038-01-06"]) assert.ok(message!.includes(line(day)));
    }
  } finally { await f.cleanup(); }
});

test("primeira ocorrência cancelada antes do envio: resumo entregue sem ela", { skip: !disposable }, async () => {
  const f = await fixture();
  try {
    const series = await createSeries(f, "2038-02-01", "2038-02-03");
    await cancelBookingSeries({ bookingId: series.bookingIds[0]!, scope: "SINGLE", cancelledBy: "STAFF", requestId: `req-${randomUUID()}` });
    const { sent, send } = recorder();
    await withWhatsApp(() => deliverPendingBookingNotifications(series.requestId, { send }));
    const message = sent.get(CLIENT_E164)![0]!;
    assert.match(message, /Horários: 2/);
    assert.ok(!message.includes(line("2038-02-01")), "data cancelada não aparece");
    const rows = await creationRows(series.seriesId!);
    assert.ok(rows.every((row) => row.status === "SENT"));
    assert.ok(rows.every((row) => /Horários: 2/.test(row.message)), "outbox guarda o texto realmente enviado");
  } finally { await f.cleanup(); }
});

test("primeira ocorrência reagendada antes do envio: resumo sem o horário antigo nem o novo", { skip: !disposable }, async () => {
  const f = await fixture();
  try {
    const series = await createSeries(f, "2038-03-01", "2038-03-03");
    await updateBookingSeriesOccurrences({
      bookingId: series.bookingIds[0]!, scope: "SINGLE", serviceId: f.service.id, barberId: f.barber.id,
      customerName: "[QA] Cliente Série", customerPhone: "(20) 90000-0031", start: slot("2038-03-10", "11:00"), requestId: `req-${randomUUID()}`,
    });
    const { sent, send } = recorder();
    await withWhatsApp(() => deliverPendingBookingNotifications(series.requestId, { send }));
    const message = sent.get(CLIENT_E164)![0]!;
    assert.match(message, /Horários: 2/);
    assert.ok(!message.includes(line("2038-03-01")) && !message.includes(line("2038-03-10", "11:00")), "a ocorrência movida tem aviso próprio");
  } finally { await f.cleanup(); }
});

test("primeira ocorrência já passada: fica fora do resumo", { skip: !disposable }, async () => {
  const f = await fixture();
  try {
    const series = await createSeries(f, "2038-04-01", "2038-04-03");
    const past = new Date(Date.now() - 86_400_000);
    await prisma.booking.update({ where: { id: series.bookingIds[0]! }, data: { dateTimeStart: past, dateTimeEnd: new Date(past.getTime() + 30 * 60_000) } });
    const { sent, send } = recorder();
    await withWhatsApp(() => deliverPendingBookingNotifications(series.requestId, { send }));
    assert.match(sent.get(OWNER_E164)![0]!, /Horários: 2/);
  } finally { await f.cleanup(); }
});

test("série da equipe: link vale só para a ocorrência dele; confirmada antes do envio, sai sem link e marcada", { skip: !disposable }, async () => {
  const f = await fixture();
  try {
    const untouched = await createSeries(f, "2038-05-04", "2038-05-06", true);
    const { sent: sentA, send: sendA } = recorder();
    await withWhatsApp(() => deliverPendingBookingNotifications(untouched.requestId, { send: sendA }));
    const withLink = sentA.get(CLIENT_E164)![0]!;
    assert.equal((withLink.match(/confirmar-agendamento\?token=/g) ?? []).length, 1);
    assert.match(withLink, new RegExp(`Para confirmar o horário de .*${line("2038-05-04").replace("/", "\\/")}, use o link:`));
    assert.match(withLink, /Este link confirma somente esse horário\./);
    assert.doesNotMatch(sentA.get(OWNER_E164)![0]!, /token=/);

    const confirmedFirst = await createSeries(f, "2038-05-11", "2038-05-13", true);
    const enqueued = await prisma.notificationDelivery.findFirstOrThrow({ where: { seriesId: confirmedFirst.seriesId, idempotencyKey: { contains: ":client:" } } });
    const token = new URL(/https?:\/\/\S+confirmar-agendamento\?token=\S+/.exec(enqueued.message)![0]).searchParams.get("token")!;
    await confirmBookingByToken(token);
    const { sent, send } = recorder();
    await withWhatsApp(() => deliverPendingBookingNotifications(confirmedFirst.requestId, { send }));
    const message = sent.get(CLIENT_E164)![0]!;
    assert.doesNotMatch(message, /token=|use o link/, "link já usado não é reenviado");
    assert.match(message, new RegExp(`${line("2038-05-11").replace("/", "\\/")} — confirmado`));
    assert.equal((message.match(/— aguardando confirmação/g) ?? []).length, 2);
    assert.match(message, /Os horários aguardando confirmação podem ser confirmados conosco\./);
    assert.doesNotMatch(message, /todos.*confirmad/i, "não sugere confirmação global");

    const cancelledFirst = await createSeries(f, "2038-05-18", "2038-05-20", true);
    await cancelBookingSeries({ bookingId: cancelledFirst.bookingIds[0]!, scope: "SINGLE", cancelledBy: "STAFF", requestId: `req-${randomUUID()}` });
    const { sent: sentC, send: sendC } = recorder();
    await withWhatsApp(() => deliverPendingBookingNotifications(cancelledFirst.requestId, { send: sendC }));
    assert.doesNotMatch(sentC.get(CLIENT_E164)![0]!, /token=/, "link de ocorrência cancelada não é enviado");
  } finally { await f.cleanup(); }
});

test("todas as ocorrências canceladas: resumo de criação não sai; aviso de cancelamento sai", { skip: !disposable }, async () => {
  const f = await fixture();
  try {
    const series = await createSeries(f, "2038-06-01", "2038-06-03");
    const cancelRequest = `req-${randomUUID()}`;
    await cancelBookingSeries({ bookingId: series.bookingIds[0]!, scope: "ALL", cancelledBy: "CLIENT", requestId: cancelRequest });
    const { sent, send } = recorder();
    const outcomes = await withWhatsApp(() => deliverPendingBookingNotifications(series.requestId, { send }));
    assert.deepEqual(outcomes.sort(), ["expired", "expired"]);
    assert.equal(sent.size, 0);
    assert.ok((await creationRows(series.seriesId!)).every((row) => row.status === "DEAD"));
    const { sent: cancelSent, send: cancelSend } = recorder();
    await withWhatsApp(() => deliverPendingBookingNotifications(cancelRequest, { send: cancelSend }));
    assert.match(cancelSent.get(CLIENT_E164)![0]!, /Horários: 3/);
  } finally { await f.cleanup(); }
});

test("uma ocorrência ativa restante: resumo com um horário", { skip: !disposable }, async () => {
  const f = await fixture();
  try {
    const series = await createSeries(f, "2038-07-01", "2038-07-03");
    for (const bookingId of series.bookingIds.slice(0, 2)) {
      await cancelBookingSeries({ bookingId, scope: "SINGLE", cancelledBy: "STAFF", requestId: `req-${randomUUID()}` });
    }
    const { sent, send } = recorder();
    await withWhatsApp(() => deliverPendingBookingNotifications(series.requestId, { send }));
    const message = sent.get(CLIENT_E164)![0]!;
    assert.match(message, /Horários: 1/);
    assert.ok(message.includes(line("2038-07-03")));
  } finally { await f.cleanup(); }
});

test("entrega concorrente do resumo: cada destinatário recebe uma vez", { skip: !disposable }, async () => {
  const f = await fixture();
  try {
    const series = await createSeries(f, "2038-08-01", "2038-08-03");
    const { sent, send } = recorder();
    await withWhatsApp(() => Promise.all([
      deliverPendingBookingNotifications(series.requestId, { send }),
      deliverPendingBookingNotifications(series.requestId, { send }),
      deliverPendingBookingNotifications(series.requestId, { send }),
    ]));
    assert.deepEqual([...sent.keys()].sort(), [CLIENT_E164, OWNER_E164].sort());
    assert.ok([...sent.values()].every((messages) => messages.length === 1));
  } finally { await f.cleanup(); }
});

test("retry após mudança: falha, primeira ocorrência cancelada, retry envia o resumo atualizado uma vez", { skip: !disposable }, async () => {
  const f = await fixture();
  try {
    const series = await createSeries(f, "2038-09-01", "2038-09-03");
    const failing = recorder(true);
    await withWhatsApp(() => deliverPendingBookingNotifications(series.requestId, { send: failing.send, random: () => 0 }));
    const retrying = await creationRows(series.seriesId!);
    assert.ok(retrying.every((row) => row.status === "RETRY"));
    await cancelBookingSeries({ bookingId: series.bookingIds[0]!, scope: "SINGLE", cancelledBy: "CLIENT", requestId: `req-${randomUUID()}` });
    // Disposable DB: keep only this series' creation notices so leftovers from other suites cannot
    // crowd the batch (NOT alone would keep rows whose seriesId is NULL).
    await prisma.notificationDelivery.deleteMany({ where: { OR: [{ seriesId: null }, { seriesId: { not: series.seriesId } }, { event: "BOOKING_CANCELLED" }] } });
    const later = new Date(Math.max(...retrying.map((row) => row.nextRetryAt!.getTime())) + 1_000);
    const ok = recorder();
    await withWhatsApp(() => processNotificationBatch({ workerId: "series-retry", batchSize: 20, now: later, send: ok.send }));
    for (const to of [OWNER_E164, CLIENT_E164]) {
      assert.equal(ok.sent.get(to)?.length, 1);
      assert.match(ok.sent.get(to)![0]!, /Horários: 2/);
    }
    await withWhatsApp(() => processNotificationBatch({ workerId: "series-retry-2", batchSize: 20, now: new Date(later.getTime() + 3_600_000), send: ok.send }));
    assert.ok([...ok.sent.values()].every((messages) => messages.length === 1), "sem reenvio");
    assert.deepEqual((await creationRows(series.seriesId!)).map((row) => bookingAudienceFromKey(row.idempotencyKey)).sort(), ["CLIENT", "OWNER"]);
  } finally { await f.cleanup(); }
});
