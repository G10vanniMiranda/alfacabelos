import test from "node:test";
import assert from "node:assert/strict";
import { expandRecurrenceRule, weekdayForDate } from "@/lib/recurrence";
import { createAdminBookingSchema } from "@/lib/validators/schemas";

test("gera todas as quartas-feiras exatamente dentro do período", () => {
  assert.deepEqual(expandRecurrenceRule({
    frequency: "WEEKLY",
    startsOn: "2026-07-01",
    endsOn: "2026-07-31",
    weekdays: [3],
  }), ["2026-07-01", "2026-07-08", "2026-07-15", "2026-07-22", "2026-07-29"]);
});

test("inclui a data final e cruza mês e ano sem alterar o dia da semana", () => {
  const dates = expandRecurrenceRule({ frequency: "WEEKLY", startsOn: "2026-12-23", endsOn: "2027-01-13" });
  assert.deepEqual(dates, ["2026-12-23", "2026-12-30", "2027-01-06", "2027-01-13"]);
  assert.equal(dates.every((date) => weekdayForDate(date) === 3), true);
});

test("recorrência mensal preserva o dia original depois de fevereiro", () => {
  assert.deepEqual(expandRecurrenceRule({ frequency: "MONTHLY", startsOn: "2027-01-31", endsOn: "2027-04-30" }), [
    "2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30",
  ]);
  assert.deepEqual(expandRecurrenceRule({ frequency: "MONTHLY", startsOn: "2028-01-31", endsOn: "2028-03-31" }), [
    "2028-01-31", "2028-02-29", "2028-03-31",
  ]);
});

test("suporta mais de um dia semanal e intervalo quinzenal", () => {
  assert.deepEqual(expandRecurrenceRule({
    frequency: "WEEKLY", startsOn: "2026-07-01", endsOn: "2026-07-31", interval: 2, weekdays: [3, 5],
  }), ["2026-07-01", "2026-07-03", "2026-07-15", "2026-07-17", "2026-07-29", "2026-07-31"]);
});

test("rejeita período invertido, data inválida e séries acima do limite", () => {
  assert.throws(() => expandRecurrenceRule({ frequency: "DAILY", startsOn: "2026-07-10", endsOn: "2026-07-01" }), /período/);
  assert.throws(() => expandRecurrenceRule({ frequency: "DAILY", startsOn: "2026-02-30", endsOn: "2026-03-01" }), /inválida/);
  assert.throws(() => expandRecurrenceRule({ frequency: "DAILY", startsOn: "2026-01-01", endsOn: "2026-03-31" }), /Limite de 59/);
});

test("contrato exige idempotência em recorrências e permite avulso legado", () => {
  const base = {
    serviceId: "service", barberId: "barber", customerName: "Cliente Teste",
    customerPhone: "(69) 99999-9999", start: "2035-07-11T13:00:00.000Z",
  };
  assert.equal(createAdminBookingSchema.safeParse({ ...base, recurrence: "NONE" }).success, true);
  assert.equal(createAdminBookingSchema.safeParse({ ...base, recurrence: "WEEKLY", repeatUntil: "2035-08-11" }).success, false);
  assert.equal(createAdminBookingSchema.safeParse({
    ...base, recurrence: "WEEKLY", repeatUntil: "2035-08-11", idempotencyKey: "series-request-123456",
  }).success, true);
});
