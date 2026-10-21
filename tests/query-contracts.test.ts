import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateOccupancyRate,
  decodeBookingCursor,
  encodeBookingCursor,
  getAgendaPollingDelay,
  mergeBookingChanges,
  parseAdminBookingsQuery,
  shouldUseIncrementalPolling,
} from "../lib/query-contracts";
import type { BookingWithRelations } from "../types/domain";

function booking(id: string, dateTimeStart: string, updatedAt = dateTimeStart): BookingWithRelations {
  return {
    id,
    barberId: "barber-1",
    serviceId: "service-1",
    customerName: `Cliente ${id}`,
    customerPhone: "69999999999",
    dateTimeStart,
    dateTimeEnd: new Date(new Date(dateTimeStart).getTime() + 3_600_000).toISOString(),
    status: "PENDENTE",
    paymentStatus: "PENDENTE",
    createdBy: "CLIENT",
    createdAt: dateTimeStart,
    updatedAt,
    barber: { id: "barber-1", name: "Barbeiro", isActive: true },
    service: { id: "service-1", name: "Corte", durationMinutes: 60, isProcedure: false, priceCents: 5000, isActive: true },
  };
}

test("agenda defaults to one Porto Velho business day instead of an unbounded query", () => {
  const query = parseAdminBookingsQuery(new URLSearchParams("date=2026-08-01"));
  assert.equal(query.start, "2026-08-01T04:00:00.000Z");
  assert.equal(query.end, "2026-08-02T03:59:59.999Z");
  assert.equal(query.limit, 200);
});

test("agenda validates reversed, excessive and partially specified ranges", () => {
  assert.throws(() => parseAdminBookingsQuery(new URLSearchParams({
    start: "2026-08-02T04:00:00.000Z",
    end: "2026-08-01T04:00:00.000Z",
  })), /início/);
  assert.throws(() => parseAdminBookingsQuery(new URLSearchParams({
    start: "2026-01-01T04:00:00.000Z",
    end: "2026-03-01T04:00:00.000Z",
  })), /intervalo máximo/);
  assert.throws(() => parseAdminBookingsQuery(new URLSearchParams({ start: "2026-08-01T04:00:00.000Z" })));
  assert.throws(() => parseAdminBookingsQuery(new URLSearchParams({ date: "2026-08-01", limit: "501" })));
});

test("booking cursor round-trips and rejects malformed values", () => {
  const source = { dateTimeStart: "2026-08-01T14:00:00.000Z", id: "booking-42" };
  assert.deepEqual(decodeBookingCursor(encodeBookingCursor(source)), source);
  assert.throws(() => decodeBookingCursor("not-a-cursor"), /Cursor inválido/);
});

test("incremental merge updates rows without duplicating and keeps deterministic order", () => {
  const first = booking("a", "2026-08-01T14:00:00.000Z");
  const second = booking("b", "2026-08-01T15:00:00.000Z");
  const changed = { ...first, status: "CONFIRMADO" as const, updatedAt: "2026-08-01T16:00:00.000Z" };
  const third = booking("c", "2026-08-01T14:00:00.000Z");
  const merged = mergeBookingChanges([first, second], [changed, third]);
  assert.deepEqual(merged.map((item) => item.id), ["a", "c", "b"]);
  assert.equal(merged.filter((item) => item.id === "a").length, 1);
  assert.equal(merged[0]?.status, "CONFIRMADO");
});

test("polling pauses aggressively when hidden and applies bounded exponential backoff", () => {
  assert.equal(getAgendaPollingDelay("visible", 0), 15_000);
  assert.equal(getAgendaPollingDelay("visible", 2), 60_000);
  assert.equal(getAgendaPollingDelay("hidden", 0), 60_000);
  assert.equal(getAgendaPollingDelay("hidden", 3), 120_000);
  assert.equal(getAgendaPollingDelay("visible", 99), 120_000);
  assert.equal(shouldUseIncrementalPolling(1), true);
  assert.equal(shouldUseIncrementalPolling(3), true);
  assert.equal(shouldUseIncrementalPolling(4), false);
});

test("dashboard occupancy handles empty capacity, normal values and overbooking", () => {
  assert.equal(calculateOccupancyRate(0, 480), 0);
  assert.equal(calculateOccupancyRate(240, 480), 50);
  assert.equal(calculateOccupancyRate(600, 480), 100);
  assert.equal(calculateOccupancyRate(60, 0), 0);
});
