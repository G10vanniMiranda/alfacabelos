import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { hashRateLimitIdentifier } from "@/lib/security";
import { createClientSession } from "@/lib/auth/client-store";

const baseUrl = (process.env.TEST_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const runId = randomUUID().slice(0, 8);
const phone = `(69) 98${String(Date.now()).slice(-7)}`;

async function main() {
  const barber = await prisma.barber.create({ data: { name: `API QA Barber ${runId}`, isActive: true } });
  const service = await prisma.service.create({ data: { name: `API QA Service ${runId}`, durationMinutes: 45, priceCents: 100, isActive: true } });
  const client = await prisma.client.create({ data: { name: `API Cliente ${runId}`, phone, phoneNormalized: phone.replace(/\D/g, ""), hasPassword: false, status: "PENDING", createdBy: "CLIENT" } });
  const session = await createClientSession(client.id);
  const identifierHash = hashRateLimitIdentifier(`127.0.0.1:${client.id}`);
  try {
    const protectedResponse = await fetch(`${baseUrl}/api/admin/bookings`);
    assert.equal(protectedResponse.status, 401, "API administrativa deve recusar requisição sem sessão");

    const slotsResponse = await fetch(`${baseUrl}/api/available-slots?date=2037-07-14&barberId=${barber.id}&serviceId=${service.id}`);
    assert.equal(slotsResponse.status, 200);
    const slots = await slotsResponse.json() as Array<{ start: string }>;
    assert.ok(slots[0]?.start, "API deve fornecer ao menos um horário para a fixture");
    const payload = {
      serviceId: service.id,
      barberId: barber.id,
      start: slots[0].start,
      customerName: `API Cliente ${runId}`,
      customerPhone: phone,
    };
    const request = () => fetch(`${baseUrl}/api/booking`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "127.0.0.1",
        origin: baseUrl,
        cookie: `barber_client=${session.token}`,
      },
      body: JSON.stringify(payload),
    });
    const responses = await Promise.all([request(), request()]);
    const statuses = responses.map((response) => response.status).sort();
    assert.deepEqual(statuses, [201, 409]);
    const persisted = await prisma.booking.count({ where: { barberId: barber.id, status: { not: "CANCELADO" } } });
    assert.equal(persisted, 1);
    console.log("PASS api:authorization — rota administrativa respondeu 401 sem sessão");
    console.log("PASS api:concurrency — respostas 201/409 e exatamente 1 registro persistido");
  } finally {
    await prisma.booking.deleteMany({ where: { barberId: barber.id } });
    await prisma.securityRateLimitEvent.deleteMany({ where: { scope: "public-booking-create", identifierHash } });
    await prisma.client.deleteMany({ where: { id: client.id } });
    await prisma.service.deleteMany({ where: { id: service.id } });
    await prisma.barber.deleteMany({ where: { id: barber.id } });
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("FAIL api validation —", error instanceof Error ? error.message : "erro inesperado");
  process.exitCode = 1;
});
