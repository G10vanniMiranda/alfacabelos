import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { beforeEach, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { enqueueWhatsAppNotification, processNotificationBatch } from "../lib/notifications/service";
import { authorizeWhatsAppSend, reserveCanarySlot } from "../lib/notifications/send-authorization";
import { readCanaryConfig, type CanaryConfig } from "../lib/notifications/canary-config";
import { replayDeadNotification } from "../lib/notifications/replay";
import type { WhatsAppSendResult } from "../lib/notifications/whatsapp-provider";

const databaseUrl = process.env.DATABASE_URL ?? "";
const disposable = process.env.RUN_DATABASE_TESTS === "true"
  && (/localhost|127\.0\.0\.1/.test(databaseUrl) || /_ci(?:\?|$)/.test(databaseUrl));

// Synthetic numbers only.
const ALLOWED = "5569999990001";
const OUTSIDER = "5569999990003";

function canaryConfig(maxMessages: number): CanaryConfig {
  return {
    roundId: `it-${randomUUID().slice(0, 8)}`, instanceId: "Shop Instance", maxMessages,
    expiresAt: new Date(Date.now() + 3_600_000), recipients: new Set([ALLOWED]),
  };
}

beforeEach(async () => {
  if (!disposable) return;
  await prisma.notificationDelivery.deleteMany();
  await prisma.operationalHeartbeat.deleteMany({ where: { worker: { startsWith: "whatsapp-canary:" } } });
});

test("canary budget is atomic across concurrent reservations", { skip: !disposable }, async () => {
  const config = canaryConfig(12);
  const slots = await Promise.all(Array.from({ length: 40 }, () => reserveCanarySlot(config)));
  const granted = slots.filter((slot): slot is number => slot !== null).sort((a, b) => a - b);
  assert.deepEqual(granted, Array.from({ length: 12 }, (_, i) => i + 1));
  assert.equal(slots.filter((slot) => slot === null).length, 28);
});

test("canary budget survives a process restart (new database client)", { skip: !disposable }, async () => {
  const config = canaryConfig(3);
  assert.equal(await reserveCanarySlot(config), 1);
  assert.equal(await reserveCanarySlot(config), 2);
  const restarted = new PrismaClient();
  try {
    const row = await restarted.operationalHeartbeat.findUniqueOrThrow({ where: { worker: `whatsapp-canary:${config.roundId}` } });
    assert.equal(row.processedCount, 2);
  } finally {
    await restarted.$disconnect();
  }
  assert.equal(await reserveCanarySlot(config), 3);
  assert.equal(await reserveCanarySlot(config), null);
});

test("worker path: three concurrent workers, allowlist enforced before the provider, replay stays blocked", { skip: !disposable }, async () => {
  const config = canaryConfig(12);
  const ref = "homologrefhomologref";
  // A complete homologation canary environment for the pure policy; the budget uses the real test database.
  const env = {
    APP_ENV: "homologation", WHATSAPP_ENABLED: "true", WHATSAPP_PROVIDER: "evolution",
    WHATSAPP_API_URL: "https://evolution.example.test/message/sendText/{instanceId}", WHATSAPP_API_TOKEN: "t",
    WHATSAPP_INSTANCE_ID: "Shop Instance", PRODUCTION_EVOLUTION_INSTANCE_ID: "Shop Instance",
    DATABASE_URL: `postgresql://postgres.${ref}@pooler.supabase.com:6543/postgres`,
    DIRECT_URL: `postgresql://postgres@db.${ref}.supabase.co:5432/postgres`,
    APP_URL: "https://homolog.alfa.example.test", CRON_SECRET: "cron-secret-0123456789",
    SUPABASE_URL: `https://${ref}.supabase.co`, SUPABASE_PROJECT_REF: ref, SUPABASE_SERVICE_ROLE_KEY: "x",
    SUPABASE_STORAGE_BUCKET: "alfa-homolog", PASSWORD_RESET_SECRET: "s".repeat(64),
    PRODUCTION_SUPABASE_PROJECT_REF: "prodrefprodrefprodre", PRODUCTION_APP_HOST: "alfa.example.test", PRODUCTION_STORAGE_BUCKET: "barber",
    WHATSAPP_CANARY_ENABLED: "true", WHATSAPP_CANARY_ROUND_ID: config.roundId, WHATSAPP_CANARY_INSTANCE_ID: "Shop Instance",
    WHATSAPP_CANARY_EXPIRES_AT: config.expiresAt.toISOString(), WHATSAPP_CANARY_MAX_MESSAGES: "12", WHATSAPP_CANARY_ALLOWLIST: ALLOWED,
  };
  const providerCalls: string[] = [];
  // Real authorization decision and real database budget; only the HTTP transport is faked.
  const send = async (input: { to: string }): Promise<WhatsAppSendResult> => {
    const decision = await authorizeWhatsAppSend({ to: input.to, provider: "evolution", context: "it" }, { env });
    if (!decision.allowed) return { ok: false, retryable: decision.retryable, category: "send_blocked", error: `WhatsApp send blocked: ${decision.reason}` };
    providerCalls.push(input.to);
    return { ok: true, providerMessageId: randomUUID() };
  };
  const alwaysValid = async () => ({ outcome: "VALID" as const, validUntil: null });

  for (let index = 0; index < 4; index += 1) {
    await enqueueWhatsAppNotification(prisma, {
      event: "PASSWORD_RESET", to: index === 3 ? OUTSIDER : ALLOWED, message: `Canary ${index}`,
      context: "integration", idempotencyKey: `canary:${randomUUID()}`,
    });
  }
  const previous = process.env.WHATSAPP_ENABLED;
  process.env.WHATSAPP_ENABLED = "true";
  try {
    await Promise.all(["a", "b", "c"].map((id) => processNotificationBatch({ workerId: `canary-${id}`, batchSize: 10, send, validate: alwaysValid })));
  } finally {
    if (previous === undefined) delete process.env.WHATSAPP_ENABLED; else process.env.WHATSAPP_ENABLED = previous;
  }

  assert.equal(providerCalls.length, 3);
  assert.ok(providerCalls.every((to) => to === ALLOWED));
  const blocked = await prisma.notificationDelivery.findFirstOrThrow({ where: { recipient: OUTSIDER } });
  assert.equal(blocked.status, "DEAD");
  assert.equal(blocked.errorCategory, "send_blocked");
  assert.equal(await prisma.notificationDelivery.count({ where: { status: "SENT" } }), 3);

  // An audited replay re-queues the row, but the gate still refuses the provider call.
  const replay = await replayDeadNotification({ notificationId: blocked.id, actorId: "it-admin", requestId: randomUUID(), reason: "it" });
  if (replay.ok) {
    process.env.WHATSAPP_ENABLED = "true";
    try {
      await processNotificationBatch({ workerId: "canary-replay", batchSize: 10, send, validate: alwaysValid });
    } finally {
      if (previous === undefined) delete process.env.WHATSAPP_ENABLED; else process.env.WHATSAPP_ENABLED = previous;
    }
  }
  assert.equal(providerCalls.length, 3);
  assert.equal((await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: blocked.id } })).status, "DEAD");
});

test("canary config parsed from env feeds the same database budget", { skip: !disposable }, () => {
  const state = readCanaryConfig({
    WHATSAPP_CANARY_ENABLED: "true", WHATSAPP_CANARY_ROUND_ID: "it-env", WHATSAPP_CANARY_INSTANCE_ID: "Shop Instance",
    WHATSAPP_CANARY_EXPIRES_AT: new Date(Date.now() + 60_000).toISOString(), WHATSAPP_CANARY_MAX_MESSAGES: "2",
    WHATSAPP_CANARY_ALLOWLIST: ALLOWED,
  }, new Date());
  assert.equal(state.status, "active");
});
