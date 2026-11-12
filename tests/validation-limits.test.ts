import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { decodeBookingCursor, encodeBookingCursor, parseAdminBookingsQuery } from "@/lib/query-contracts";
import {
  MAX_AVAILABILITY_RANGES_PER_DAY,
  adminLoginSchema,
  clientRegisterSchema,
  createAdminAccessSchema,
  createAdminBookingSchema,
  createBlockedSlotSchema,
  createBookingSchema,
  createServiceSchema,
  recoveryCodeSchema,
  replaceBarberDayAvailabilitySchema,
} from "@/lib/validators/schemas";

const recurringBase = {
  serviceId: "service-1",
  barberId: "barber-1",
  customerName: "Cliente QA",
  customerPhone: "(69) 99999-9999",
  start: "2030-01-01T13:00:00.000Z",
  recurrence: "WEEKLY",
  idempotencyKey: "k".repeat(20),
  repeatUntil: "2030-03-01",
};

function firstMessage(result: { success: boolean; error?: { issues: Array<{ message: string }> } }) {
  return result.success ? undefined : result.error?.issues[0]?.message;
}

test("zod is on a release patched for GHSA-mrhx-c7xc-m3w5 (>= 4.6.6)", () => {
  const require = createRequire(import.meta.url);
  const { version } = JSON.parse(readFileSync(require.resolve("zod/package.json"), "utf8")) as { version: string };
  const [major, minor, patch] = version.split(".").map(Number);
  assert.ok(major > 4 || (major === 4 && (minor > 6 || (minor === 6 && patch >= 6))), version);
});

test("oversized collections are rejected by size before element validation", () => {
  const starts = createAdminBookingSchema.safeParse({ ...recurringBase, starts: Array.from({ length: 200_000 }, () => "x") });
  assert.equal(starts.success, false);
  assert.equal(starts.error?.issues.length, 1);
  assert.equal(firstMessage(starts), "Limite de 59 repetições por criação. Reduza o período.");

  const ranges = replaceBarberDayAvailabilitySchema.safeParse({
    barberId: "barber-1",
    dayOfWeek: 1,
    ranges: Array.from({ length: 200_000 }, () => ({ openTime: "bad", closeTime: "bad" })),
  });
  assert.equal(ranges.success, false);
  assert.equal(ranges.error?.issues.length, 1);
  assert.equal(firstMessage(ranges), `Limite de ${MAX_AVAILABILITY_RANGES_PER_DAY} faixas de horário por dia`);
});

test("availability accepts up to the per-day range limit and still rejects overlaps", () => {
  const ranges = Array.from({ length: MAX_AVAILABILITY_RANGES_PER_DAY }, (_, hour) => ({
    openTime: `${String(hour).padStart(2, "0")}:00`,
    closeTime: `${String(hour).padStart(2, "0")}:30`,
  }));
  assert.equal(replaceBarberDayAvailabilitySchema.safeParse({ barberId: "barber-1", dayOfWeek: 1, ranges }).success, true);
  assert.equal(replaceBarberDayAvailabilitySchema.safeParse({ barberId: "barber-1", dayOfWeek: 1, ranges: [] }).success, true);

  const overlap = replaceBarberDayAvailabilitySchema.safeParse({
    barberId: "barber-1",
    dayOfWeek: 1,
    ranges: [{ openTime: "09:00", closeTime: "12:00" }, { openTime: "11:00", closeTime: "13:00" }],
  });
  assert.equal(firstMessage(overlap), "As faixas de horário não podem se sobrepor");
});

test("free-text, identifier and secret fields are bounded", () => {
  const long = "a".repeat(10_000);
  assert.equal(firstMessage(createBookingSchema.safeParse({ serviceId: "s", start: recurringBase.start, customerName: long, customerPhone: "(69) 99999-9999" })), "Nome muito longo");
  assert.equal(createBookingSchema.safeParse({ serviceId: long, start: recurringBase.start, customerName: "Ana", customerPhone: "(69) 99999-9999" }).success, false);
  assert.equal(createBookingSchema.safeParse({ serviceId: "s", start: recurringBase.start, customerName: "Ana", customerPhone: long }).success, false);
  assert.equal(adminLoginSchema.safeParse({ email: `${long}@example.com`, password: "x" }).success, false);
  assert.equal(adminLoginSchema.safeParse({ email: "admin@example.com", password: long }).success, false);
  assert.equal(createBlockedSlotSchema.safeParse({ dateTimeStart: recurringBase.start, dateTimeEnd: recurringBase.start, reason: long }).success, false);
  assert.equal(recoveryCodeSchema.safeParse({ code: long }).success, false);
  assert.equal(createAdminBookingSchema.safeParse({ ...recurringBase, repeatUntil: long }).success, false);
  const reschedule = { ...recurringBase, recurrence: "NONE", idempotencyKey: undefined, repeatUntil: undefined };
  assert.equal(firstMessage(createAdminBookingSchema.safeParse({ ...reschedule, rescheduleBookingId: long })), "Agendamento inválido");
  assert.equal(createAdminBookingSchema.parse({ ...reschedule, rescheduleBookingId: "booking-1" }).rescheduleBookingId, "booking-1");
});

test("transforms, defaults, refinements and coercion keep their v3 behaviour", () => {
  assert.deepEqual(recoveryCodeSchema.parse({ code: "1234-5678" }), { code: "12345678" });
  assert.equal(recoveryCodeSchema.safeParse({ code: "1234" }).success, false);

  assert.equal(createAdminAccessSchema.parse({ email: "a@b.co", password: "12345678", confirmPassword: "12345678" }).role, "ADMIN");
  assert.equal(createServiceSchema.parse({ name: "Corte", priceCents: 4500, durationMinutes: 30 }).isProcedure, false);

  const mismatch = clientRegisterSchema.safeParse({ name: "Ana", phone: "(69) 99999-9999", password: "12345678", confirmPassword: "87654321" });
  assert.deepEqual(mismatch.error?.issues.map((issue) => [issue.path.join("."), issue.message]), [["confirmPassword", "As senhas não conferem"]]);

  assert.equal(firstMessage(createAdminBookingSchema.safeParse({ ...recurringBase, idempotencyKey: undefined })), "Chave de idempotência obrigatória para recorrência");
  assert.equal(createBookingSchema.safeParse({ serviceId: "s", start: "2030-01-01T10:00:00-03:00", customerName: "Ana", customerPhone: "(69) 99999-9999" }).success, false);

  assert.equal(parseAdminBookingsQuery(new URLSearchParams("date=2030-01-01&limit=10")).limit, 10);
  assert.equal(parseAdminBookingsQuery(new URLSearchParams("date=2030-01-01")).limit, 200);
  assert.throws(() => parseAdminBookingsQuery(new URLSearchParams("date=2030-01-01&limit=501")));
  assert.throws(() => parseAdminBookingsQuery(new URLSearchParams("start=2030-01-01T00:00:00Z")), /start e end devem ser informados juntos/);

  const cursor = { dateTimeStart: "2030-01-01T13:00:00.000Z", id: "booking-1" };
  assert.deepEqual(decodeBookingCursor(encodeBookingCursor(cursor)), cursor);
  assert.throws(() => decodeBookingCursor("not-a-cursor"), /Cursor inválido/);
});
