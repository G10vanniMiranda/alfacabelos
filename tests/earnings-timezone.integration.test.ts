import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { getEarningsData } from "../lib/booking-query-service";
import { BUSINESS_CONFIG } from "../lib/config";
import { prisma } from "../lib/prisma";
import { getDayRangeIso, zonedDateTimeToUtcIso } from "../lib/utils";

const databaseUrl = process.env.DATABASE_URL ?? "";
const disposable = process.env.RUN_DATABASE_TESTS === "true"
  && (/localhost|127\.0\.0\.1/.test(databaseUrl) || /_ci(?:\?|$)/.test(databaseUrl));

test("ganhos diários agrupam pelo dia local do negócio, inclusive à noite", { skip: !disposable }, async () => {
  const runId = randomUUID();
  const tz = BUSINESS_CONFIG.timezone;
  const day = "2038-03-10";
  let barberId: string | undefined;
  let serviceId: string | undefined;
  try {
    barberId = (await prisma.barber.create({ data: { name: `Earnings Barber ${runId}` } })).id;
    serviceId = (await prisma.service.create({ data: { name: `Earnings Service ${runId}`, durationMinutes: 30, priceCents: 3000 } })).id;
    for (const [from, to] of [["09:00", "09:30"], ["21:00", "21:30"]]) {
      await prisma.booking.create({ data: {
        barberId, serviceId, customerName: "Cliente Teste", customerPhone: "69999990001",
        dateTimeStart: new Date(zonedDateTimeToUtcIso(day, from, tz)), dateTimeEnd: new Date(zonedDateTimeToUtcIso(day, to, tz)),
        createdBy: "CLIENT", paymentStatus: "CONFIRMADO",
      } });
    }
    const range = getDayRangeIso(day, tz);
    const earnings = await getEarningsData({ start: range.start, end: range.end, barberId });
    assert.deepEqual(earnings.dailyRevenue, [{ key: day, label: "10/03/2038", totalCents: 6000, bookingsCount: 2 }]);
  } finally {
    if (barberId) await prisma.booking.deleteMany({ where: { barberId } });
    if (serviceId) await prisma.service.delete({ where: { id: serviceId } });
    if (barberId) await prisma.barber.delete({ where: { id: barberId } });
  }
});
