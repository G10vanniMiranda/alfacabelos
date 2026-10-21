import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { prisma } from "../lib/prisma";
import { prismaRepository } from "../lib/repositories/prisma";

const databaseUrl = process.env.DATABASE_URL ?? "";
const disposable = process.env.RUN_DATABASE_TESTS === "true"
  && (/localhost|127\.0\.0\.1/.test(databaseUrl) || /_ci(?:\?|$)/.test(databaseUrl));

test("alterar pagamento avança Booking.updatedAt para o polling incremental", { skip: !disposable }, async () => {
  const runId = randomUUID();
  let barberId: string | undefined;
  let serviceId: string | undefined;
  let bookingId: string | undefined;
  try {
    barberId = (await prisma.barber.create({ data: { name: `UpdatedAt Barber ${runId}` } })).id;
    serviceId = (await prisma.service.create({ data: { name: `UpdatedAt Service ${runId}`, durationMinutes: 30, priceCents: 3000 } })).id;
    bookingId = (await prisma.booking.create({ data: {
      barberId, serviceId, customerName: "Cliente Teste", customerPhone: "69999990000",
      dateTimeStart: new Date("2038-02-01T14:00:00.000Z"), dateTimeEnd: new Date("2038-02-01T14:30:00.000Z"), createdBy: "CLIENT",
    } })).id;
    const cursor = new Date();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await prismaRepository.updateBookingPaymentStatus(bookingId, "CONFIRMADO");
    const changed = await prisma.booking.findMany({ where: { id: bookingId, updatedAt: { gt: cursor } }, select: { id: true } });
    assert.equal(changed.length, 1);
  } finally {
    if (bookingId) await prisma.booking.delete({ where: { id: bookingId } });
    if (serviceId) await prisma.service.delete({ where: { id: serviceId } });
    if (barberId) await prisma.barber.delete({ where: { id: barberId } });
  }
});
