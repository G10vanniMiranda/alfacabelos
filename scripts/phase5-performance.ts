import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { assertSafeTestEnvironment } from "@/scripts/assert-safe-test-environment";

const prefix = "phase5-perf-";

async function cleanup() {
  await prisma.notificationDelivery.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.booking.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.blockedSlot.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.client.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.service.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.barber.deleteMany({ where: { id: { startsWith: prefix } } });
}

async function explain(name: string, sql: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ "QUERY PLAN": unknown }>>(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`);
  const raw = rows[0]?.["QUERY PLAN"];
  const document = (Array.isArray(raw) ? raw : JSON.parse(String(raw))) as Array<{ Plan: Plan; "Planning Time": number; "Execution Time": number }>;
  const root = document[0]!;
  const nodes: Array<{ node: string; relation?: string; index?: string; rows: number; loops: number }> = [];
  let sharedHit = 0;
  let sharedRead = 0;
  function visit(plan: Plan) {
    nodes.push({ node: plan["Node Type"], relation: plan["Relation Name"], index: plan["Index Name"], rows: plan["Actual Rows"], loops: plan["Actual Loops"] });
    sharedHit += plan["Shared Hit Blocks"] ?? 0;
    sharedRead += plan["Shared Read Blocks"] ?? 0;
    for (const child of plan.Plans ?? []) visit(child);
  }
  visit(root.Plan);
  console.log(JSON.stringify({ name, planningMs: root["Planning Time"], executionMs: root["Execution Time"], sharedHit, sharedRead, nodes }));
}

type Plan = {
  "Node Type": string;
  "Relation Name"?: string;
  "Index Name"?: string;
  "Actual Rows": number;
  "Actual Loops": number;
  "Shared Hit Blocks"?: number;
  "Shared Read Blocks"?: number;
  Plans?: Plan[];
};

async function main() {
  assertSafeTestEnvironment();
  await cleanup();
  const barbers = Array.from({ length: 10 }, (_, i) => ({ id: `${prefix}barber-${i}`, name: `Performance Barber ${i}` }));
  const services = Array.from({ length: 10 }, (_, i) => ({ id: `${prefix}service-${i}`, name: `Performance Service ${i}`, durationMinutes: 30 + (i % 3) * 10, priceCents: 3000 + i * 500 }));
  const clients = Array.from({ length: 1_000 }, (_, i) => ({
    id: `${prefix}client-${i}`, name: `Performance Client ${i}`, phone: `699${String(i).padStart(8, "0")}`,
    phoneNormalized: `699${String(i).padStart(8, "0")}`, hasPassword: false, status: "PENDING" as const, createdBy: "BARBER" as const,
  }));
  await prisma.barber.createMany({ data: barbers });
  await prisma.service.createMany({ data: services });
  await prisma.client.createMany({ data: clients });

  const base = Date.UTC(2026, 0, 1, 12, 0, 0);
  for (let offset = 0; offset < 10_000; offset += 1_000) {
    const rows = Array.from({ length: 1_000 }, (_, j) => {
      const i = offset + j;
      const start = new Date(base + (i % 365) * 86_400_000 + (i % 10) * 3_600_000);
      return {
        id: `${prefix}booking-${i}`, barberId: barbers[i % 10]!.id, serviceId: services[i % 10]!.id,
        clientId: clients[i % 1_000]!.id, customerName: clients[i % 1_000]!.name,
        customerPhone: clients[i % 1_000]!.phone, dateTimeStart: start,
        dateTimeEnd: new Date(start.getTime() + 45 * 60_000), status: (["PENDENTE", "CONFIRMADO", "CONCLUIDO", "CANCELADO"] as const)[i % 4],
        paymentStatus: i % 3 === 0 ? "CONFIRMADO" as const : "PENDENTE" as const,
        createdBy: i % 2 === 0 ? "CLIENT" as const : "BARBER" as const,
        updatedAt: new Date(base + (i % 720) * 60_000),
      };
    });
    await prisma.booking.createMany({ data: rows });
  }
  await prisma.blockedSlot.createMany({ data: Array.from({ length: 500 }, (_, i) => {
    const start = new Date(base + (i % 365) * 86_400_000);
    return { id: `${prefix}block-${i}`, barberId: barbers[i % 10]!.id, dateTimeStart: start, dateTimeEnd: new Date(start.getTime() + 3_600_000), reason: "performance" };
  }) });
  const statuses = ["PENDING", "PROCESSING", "SENT", "RETRY", "DEAD"] as const;
  for (let offset = 0; offset < 5_000; offset += 1_000) {
    await prisma.notificationDelivery.createMany({ data: Array.from({ length: 1_000 }, (_, j) => {
      const i = offset + j;
      const status = statuses[i % statuses.length]!;
      return {
        id: `${prefix}notification-${i}`, event: "BOOKING_REMINDER" as const, recipient: "5569999999999",
        recipientMasked: "*********9999", message: "performance", context: "performance",
        idempotencyKey: `${prefix}notification-key-${i}`, status, attempts: status === "RETRY" || status === "DEAD" ? 3 : 0,
        nextRetryAt: status === "RETRY" ? new Date(0) : null, sentAt: status === "SENT" ? new Date() : null,
        processedAt: status === "SENT" || status === "DEAD" ? new Date() : null,
      };
    }) });
  }
  await prisma.$executeRawUnsafe('ANALYZE "Booking", "BlockedSlot", "NotificationDelivery"');
  console.log("DATASET bookings=10000 clients=1000 barbers=10 services=10 notifications=5000 blockedSlots=500");
  const dayStart = `'2026-06-01T00:00:00Z'::timestamptz`;
  const dayEnd = `'2026-06-02T00:00:00Z'::timestamptz`;
  const weekEnd = `'2026-06-08T00:00:00Z'::timestamptz`;
  await explain("agenda_daily", `SELECT * FROM "Booking" WHERE "barberId"='${barbers[0]!.id}' AND "dateTimeStart">=${dayStart} AND "dateTimeStart"<${dayEnd} ORDER BY "dateTimeStart"`);
  await explain("agenda_weekly", `SELECT * FROM "Booking" WHERE "barberId"='${barbers[0]!.id}' AND "dateTimeStart">=${dayStart} AND "dateTimeStart"<${weekEnd} ORDER BY "dateTimeStart"`);
  await explain("client_history", `SELECT * FROM "Booking" WHERE "clientId"='${clients[0]!.id}' ORDER BY "dateTimeStart" DESC, id DESC LIMIT 20`);
  await explain("dashboard", `SELECT status, count(*) FROM "Booking" WHERE "dateTimeStart">=${dayStart} AND "dateTimeStart"<${weekEnd} GROUP BY status`);
  await explain("earnings", `SELECT "paymentStatus", sum(s."priceCents") FROM "Booking" b JOIN "Service" s ON s.id=b."serviceId" WHERE b."dateTimeStart">=${dayStart} AND b."dateTimeStart"<${weekEnd} GROUP BY "paymentStatus"`);
  await explain("polling", `SELECT id, "updatedAt" FROM "Booking" WHERE "updatedAt">'2026-01-01T06:00:00Z'::timestamptz ORDER BY "updatedAt", id LIMIT 100`);
  await explain("outbox_claim", `SELECT id FROM "NotificationDelivery" WHERE status IN ('PENDING','RETRY') AND ("nextRetryAt" IS NULL OR "nextRetryAt"<=now()) ORDER BY "nextRetryAt" NULLS FIRST, "createdAt" LIMIT 25`);
  await explain("outbox_metrics", `SELECT status, count(*) FROM "NotificationDelivery" GROUP BY status`);
  await explain("blocked_overlap", `SELECT id FROM "BlockedSlot" WHERE ("barberId" IS NULL OR "barberId"='${barbers[0]!.id}') AND "dateTimeStart"<${dayEnd} AND "dateTimeEnd">${dayStart}`);
}

main().finally(async () => { await cleanup(); await prisma.$disconnect(); });
