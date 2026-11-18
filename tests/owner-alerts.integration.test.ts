import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { prisma } from "../lib/prisma";
import { cancelBookingSeries, createBookingSeriesAtomic, updateBookingSeriesOccurrences } from "../lib/booking-series-service";
import { listOwnerAlerts } from "../lib/notifications/owner-alerts";
import { zonedDateTimeToUtcIso } from "../lib/utils";

// Disposable local database only; synthetic numbers (DDD 20 is not assigned in Brazil).
const databaseUrl = process.env.DATABASE_URL ?? "";
const disposable = process.env.RUN_DATABASE_TESTS === "true" && /localhost|127\.0\.0\.1/.test(databaseUrl);
const CLIENT = "(20) 90000-0041";
const TZ = "America/Porto_Velho";
const slot = (localDate: string, time = "09:00") => zonedDateTimeToUtcIso(localDate, `${time}:00`, TZ);

async function fixture() {
  const barber = await prisma.barber.create({ data: { name: `[QA] Barbeiro Alertas ${randomUUID().slice(0, 8)}` } });
  const service = await prisma.service.create({ data: { name: "[QA] Corte Alertas", durationMinutes: 30, priceCents: 1000 } });
  await prisma.barberAvailability.createMany({
    data: Array.from({ length: 7 }, (_, dayOfWeek) => ({ barberId: barber.id, dayOfWeek, openTime: "08:00", closeTime: "20:00" })),
  });
  return { barber, service };
}

test("every booking change leaves a persistent owner alert, scoped per barber", { skip: !disposable }, async () => {
  const f = await fixture();
  const other = await fixture();
  const input = (barberId: string, serviceId: string, localDate: string, extra: Record<string, unknown> = {}) => ({
    serviceId, barberId, customerName: "[QA] Cliente Alertas", customerPhone: CLIENT, start: slot(localDate),
    recurrence: "NONE" as const, idempotencyKey: randomUUID(), createdBy: "CLIENT" as const, requestId: `req-${randomUUID()}`, ...extra,
  });

  const single = await createBookingSeriesAtomic(input(f.barber.id, f.service.id, "2037-06-01"));
  const bookingId = single.bookingIds[0]!;
  await updateBookingSeriesOccurrences({
    bookingId, scope: "SINGLE", serviceId: f.service.id, barberId: f.barber.id,
    customerName: "[QA] Cliente Alertas", customerPhone: CLIENT, start: slot("2037-06-01", "11:00"), requestId: `req-${randomUUID()}`,
  });
  await cancelBookingSeries({ bookingId, scope: "SINGLE", cancelledBy: "CLIENT", requestId: `req-${randomUUID()}` });
  const series = await createBookingSeriesAtomic(input(f.barber.id, f.service.id, "2037-06-10", {
    recurrence: "DAILY", repeatUntil: "2037-06-12", createdBy: "BARBER",
  }));
  await createBookingSeriesAtomic(input(other.barber.id, other.service.id, "2037-06-02"));

  const all = await listOwnerAlerts();
  const mine = all.filter((alert) => alert.booking?.customerName === "[QA] Cliente Alertas");
  const forBarber = await listOwnerAlerts({ barberId: f.barber.id });

  const events = forBarber.map((alert) => alert.event);
  assert.deepEqual(events.slice(0, 4), ["BOOKING_CREATED_BY_STAFF", "BOOKING_CANCELLED", "BOOKING_RESCHEDULED", "BOOKING_CREATED_BY_CLIENT"]);
  assert.equal(forBarber[0]!.occurrences, series.bookingIds.length);
  assert.equal(forBarber[1]!.actor, "CLIENT");
  assert.equal(forBarber[1]!.booking?.status, "CANCELADO");
  // The other barber's booking is visible to the admin but never to this barber.
  assert.ok(mine.length >= 5);
  assert.ok(forBarber.every((alert) => alert.booking !== null));
  assert.equal(forBarber.length, 4);
  // Alerts are written in the booking transaction: they never exist without the booking.
  assert.equal(await prisma.auditLog.count({ where: { action: { startsWith: "owner_alert." }, resourceId: bookingId } }), 3);
});

test("an idempotent replay of the same booking request does not repeat the owner alert", { skip: !disposable }, async () => {
  const f = await fixture();
  const single = {
    serviceId: f.service.id, barberId: f.barber.id, customerName: "[QA] Cliente Replay", customerPhone: CLIENT,
    start: slot("2037-07-01"), recurrence: "NONE" as const, idempotencyKey: randomUUID(), createdBy: "CLIENT" as const,
    requestId: `req-${randomUUID()}`,
  };
  const first = await createBookingSeriesAtomic(single);
  // A single booking has no series row: a repeat is refused by the slot conflict, again without an alert.
  await assert.rejects(createBookingSeriesAtomic(single), /Conflito com agendamento existente/);

  const seriesRequest = { ...single, idempotencyKey: randomUUID(), start: slot("2037-07-05"), recurrence: "DAILY" as const, repeatUntil: "2037-07-07" };
  const series = await createBookingSeriesAtomic(seriesRequest);
  assert.equal((await createBookingSeriesAtomic(seriesRequest)).duplicate, true);

  assert.equal(await prisma.auditLog.count({ where: { action: { startsWith: "owner_alert." }, resourceId: first.bookingIds[0]! } }), 1);
  assert.equal(await prisma.auditLog.count({ where: { action: { startsWith: "owner_alert." }, resourceId: series.bookingIds[0]! } }), 1);
  assert.equal((await listOwnerAlerts({ barberId: f.barber.id })).length, 2);
});
