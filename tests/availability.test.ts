import test from "node:test";
import assert from "node:assert/strict";
import { generateAvailableSlots } from "@/lib/time";
import { zonedDateTimeToUtcIso } from "@/lib/utils";
import type { BlockedSlot, Booking, DailyOperatingConfig } from "@/types/domain";

const date = "2035-07-10";
const dayOfWeek = new Date(`${date}T12:00:00Z`).getUTCDay();
const barberId = "barber-test";

function booking(start: string, end: string): Booking {
  return {
    id: "booking-test",
    barberId,
    serviceId: "service-test",
    customerName: "Cliente Teste",
    customerPhone: "(69) 99999-9999",
    dateTimeStart: zonedDateTimeToUtcIso(date, start, "America/Porto_Velho"),
    dateTimeEnd: zonedDateTimeToUtcIso(date, end, "America/Porto_Velho"),
    status: "PENDENTE",
    paymentStatus: "PENDENTE",
    createdBy: "CLIENT",
    createdAt: new Date().toISOString(),
  };
}

function blocked(start: string, end: string): BlockedSlot {
  return {
    id: "blocked-test",
    barberId,
    dateTimeStart: zonedDateTimeToUtcIso(date, start, "America/Porto_Velho"),
    dateTimeEnd: zonedDateTimeToUtcIso(date, end, "America/Porto_Velho"),
    reason: "Homologação",
    createdAt: new Date().toISOString(),
  };
}

function slots(input?: {
  duration?: number;
  isProcedure?: boolean;
  bookings?: Booking[];
  blocked?: BlockedSlot[];
  windows?: DailyOperatingConfig[];
}) {
  return generateAvailableSlots({
    date,
    barberId,
    serviceDurationMinutes: input?.duration ?? 60,
    serviceIsProcedure: input?.isProcedure ?? false,
    barberBookings: input?.bookings ?? [],
    blockedSlots: input?.blocked ?? [],
    operatingHours: input?.windows ?? [{ dayOfWeek, open: "09:00", close: "12:00" }],
  });
}

test("não oferece serviço que ultrapassa o fim do expediente considerando buffer", () => {
  assert.deepEqual(slots({ duration: 60, isProcedure: true }).map((slot) => slot.label), ["09:00", "10:00"]);
});

test("respeita duração variável e intervalo entre atendimentos", () => {
  assert.deepEqual(slots({ duration: 30 }).map((slot) => slot.label), ["09:00", "10:00", "11:00"]);
  assert.deepEqual(slots({ duration: 120, isProcedure: true }).map((slot) => slot.label), ["09:00"]);
});

test("remove horários sobrepostos por agendamento ou bloqueio", () => {
  assert.deepEqual(slots({ bookings: [booking("09:30:00", "10:30:00")] }).map((slot) => slot.label), ["11:00"]);
  assert.deepEqual(slots({ blocked: [blocked("10:10:00", "11:00:00")] }).map((slot) => slot.label), ["09:00", "11:00"]);
});

test("une faixas contíguas antes de validar um procedimento longo", () => {
  const result = slots({
    duration: 75,
    isProcedure: true,
    windows: [
      { dayOfWeek, open: "09:00", close: "10:00" },
      { dayOfWeek, open: "10:00", close: "11:00" },
      { dayOfWeek, open: "11:00", close: "12:00" },
    ],
  });

  assert.deepEqual(result.map((slot) => slot.label), ["09:00", "10:00"]);
});

test("não cria horários durante intervalo de almoço", () => {
  const result = slots({
    duration: 30,
    windows: [
      { dayOfWeek, open: "09:00", close: "12:00" },
      { dayOfWeek, open: "14:00", close: "16:00" },
    ],
  });
  assert.deepEqual(result.map((slot) => slot.label), ["09:00", "10:00", "11:00", "14:00", "15:00"]);
});

test("converte Porto Velho para UTC sem depender do fuso do processo", () => {
  assert.equal(zonedDateTimeToUtcIso(date, "09:00:00", "America/Porto_Velho"), "2035-07-10T13:00:00.000Z");
});
