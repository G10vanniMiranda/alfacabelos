import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { prisma } from "../lib/prisma";
import { authenticateClient, createClientSession, hashClientPassword } from "../lib/auth/client-store";
import { hashPasswordResetToken } from "../lib/auth/password-reset-security";
import { completeRecovery, issueRecoveryChallenge, requestRecoveryCode, verifyRecoveryCode } from "../lib/auth/password-recovery";
import { createRecoveryDependencies, prismaRecoveryStore } from "../lib/auth/password-recovery-store";
import {
  deriveRecoveryKeys,
  hashRecoveryHandle,
  openDeliveryPayload,
  REDACTED_DELIVERY_MESSAGE,
  sealDeliveryPayload,
} from "../lib/auth/password-recovery-crypto";
import { deliverNotificationNow, redactExpiredSealedMessages } from "../lib/notifications/service";

// Disposable local database only (same gate as the outbox integration suite).
const databaseUrl = process.env.DATABASE_URL ?? "";
const disposable = process.env.RUN_DATABASE_TESTS === "true" && /localhost|127\.0\.0\.1/.test(databaseUrl);
const SECRET = "integration-only-recovery-secret-0123456789";
process.env.PASSWORD_RESET_SECRET = SECRET;
const keys = deriveRecoveryKeys(SECRET)!;

async function fixtureClient(password = "senha-antiga-123") {
  const digits = String(Math.floor(Math.random() * 1e8)).padStart(8, "0");
  const phone = `(20) 9${digits.slice(0, 4)}-${digits.slice(4)}`;
  const client = await prisma.client.create({ data: {
    name: "[QA] Integração Recuperação", phone, phoneNormalized: `209${digits}`, passwordHash: await hashClientPassword(password),
  } });
  await createClientSession(client.id);
  await prisma.passwordResetToken.create({ data: {
    clientId: client.id, tokenHash: hashPasswordResetToken(randomUUID()), expiresAt: new Date(Date.now() + 30 * 60_000),
  } });
  return { ...client, phone };
}

async function requestRecoveryCodeAndIssue(dependencies: ReturnType<typeof deps>, input: { phone: string; ip: string; requestId: string }) {
  const result = await requestRecoveryCode(dependencies, input);
  if (result.outcome !== "sent") return result;
  return { ...result, deliveryId: await issueRecoveryChallenge(dependencies, { phone: input.phone, handle: result.handle, requestId: input.requestId }) };
}

function deps() {
  return createRecoveryDependencies({
    keys, channel: "whatsapp",
    limitRequest: async () => ({ blocked: false, retryAfterSeconds: 0 }),
  });
}

async function withWhatsApp<T>(run: () => Promise<T>): Promise<T> {
  const previous = process.env.WHATSAPP_ENABLED;
  process.env.WHATSAPP_ENABLED = "true";
  try { return await run(); } finally { process.env.WHATSAPP_ENABLED = previous; }
}

test("fluxo ponta a ponta no Postgres: código entregue, verificado, senha trocada e tudo revogado", { skip: !disposable }, async () => {
  const client = await fixtureClient();
  const requestId = `it-${randomUUID()}`;
  const requested = await requestRecoveryCodeAndIssue(deps(), { phone: client.phone, ip: "198.51.100.7", requestId });
  if (requested.outcome !== "sent" || !requested.deliveryId) return assert.fail("deveria enfileirar a entrega");

  const row = await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: requested.deliveryId } });
  const code = openDeliveryPayload(keys, row.message, row.idempotencyKey)!.otp;
  assert.ok(!row.message.includes(code), "código não fica em texto puro no outbox");

  const sent: Array<{ message: string; otp?: string }> = [];
  const outcome = await withWhatsApp(() => deliverNotificationNow(requested.deliveryId!, {
    send: async (input) => { sent.push({ message: input.message, otp: input.otp }); return { ok: true, providerMessageId: "fake-1" }; },
  }));
  assert.equal(outcome, "sent");
  assert.equal(sent.length, 1);
  assert.ok(sent[0].message.includes(code) && sent[0].otp === code, "provedor recebe o código aberto");
  const delivered = await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: requested.deliveryId } });
  assert.equal(delivered.status, "SENT");
  assert.equal(delivered.message, REDACTED_DELIVERY_MESSAGE, "payload descartado após o envio");
  assert.equal(await withWhatsApp(() => deliverNotificationNow(requested.deliveryId!)), "not_claimed", "não reenvia linha já enviada");

  const wrong = String((Number(code) + 1) % 1e8).padStart(8, "0");
  assert.equal((await verifyRecoveryCode(deps(), { handle: requested.handle, code: wrong, ip: "198.51.100.7", requestId })).outcome, "invalid");
  assert.equal((await verifyRecoveryCode(deps(), { handle: requested.handle, code, ip: "198.51.100.7", requestId })).outcome, "verified");
  assert.equal((await completeRecovery(deps(), { handle: requested.handle, password: "nova-senha-segura", requestId })).outcome, "completed");

  assert.ok(await authenticateClient(client.phone, "nova-senha-segura"), "nova senha funciona no login real");
  assert.equal(await authenticateClient(client.phone, "senha-antiga-123"), null, "senha antiga bloqueada");
  assert.equal(await prisma.clientSession.count({ where: { clientId: client.id } }), 0, "sessões revogadas");
  assert.equal(await prisma.passwordResetToken.count({ where: { clientId: client.id, usedAt: null } }), 0, "links antigos invalidados");
  const challenge = await prisma.passwordResetChallenge.findUniqueOrThrow({ where: { handleHash: hashRecoveryHandle(requested.handle) } });
  assert.ok(challenge.consumedAt && challenge.verifiedAt);
  assert.equal(challenge.attempts, 2, "a tentativa errada e a certa contam");

  const audits = await prisma.auditLog.findMany({ where: { requestId }, orderBy: { createdAt: "asc" } });
  assert.deepEqual(audits.map((item) => item.action), ["client.password_recovery.requested", "client.password_recovery.completed"]);
  const auditText = JSON.stringify(audits);
  assert.ok(!auditText.includes(code) && !auditText.includes(requested.handle), "auditoria sem segredos");
  assert.equal((await completeRecovery(deps(), { handle: requested.handle, password: "outra-senha-999", requestId })).outcome, "expired");
});

test("Postgres: tentativas simultâneas param exatamente em 5", { skip: !disposable }, async () => {
  const client = await fixtureClient();
  const requested = await requestRecoveryCodeAndIssue(deps(), { phone: client.phone, ip: "198.51.100.8", requestId: "it-attempts" });
  if (requested.outcome !== "sent") return assert.fail("deveria enviar");
  const challenge = await prisma.passwordResetChallenge.findUniqueOrThrow({ where: { handleHash: hashRecoveryHandle(requested.handle) } });
  const reserved = await Promise.all(Array.from({ length: 12 }, () => prismaRecoveryStore.reserveAttempt(challenge.id, new Date(), 5)));
  assert.equal(reserved.filter((value) => value !== null).length, 5);
  assert.equal((await prisma.passwordResetChallenge.findUniqueOrThrow({ where: { id: challenge.id } })).attempts, 5);
});

test("Postgres: duas conclusões simultâneas, uma única troca de senha", { skip: !disposable }, async () => {
  const client = await fixtureClient();
  const requested = await requestRecoveryCodeAndIssue(deps(), { phone: client.phone, ip: "198.51.100.9", requestId: "it-race" });
  if (requested.outcome !== "sent" || !requested.deliveryId) return assert.fail("deveria enviar");
  const row = await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: requested.deliveryId } });
  const code = openDeliveryPayload(keys, row.message, row.idempotencyKey)!.otp;
  await verifyRecoveryCode(deps(), { handle: requested.handle, code, ip: "198.51.100.9", requestId: "it-race" });
  const raceIds = [`it-race-a-${randomUUID()}`, `it-race-b-${randomUUID()}`];
  const results = await Promise.all([
    completeRecovery(deps(), { handle: requested.handle, password: "senha-corrida-a1", requestId: raceIds[0] }),
    completeRecovery(deps(), { handle: requested.handle, password: "senha-corrida-b2", requestId: raceIds[1] }),
  ]);
  assert.deepEqual(results.map((item) => item.outcome).sort(), ["completed", "expired"]);
  assert.equal(await prisma.auditLog.count({ where: { requestId: { in: raceIds }, action: "client.password_recovery.completed" } }), 1);
});

test("Postgres: novo pedido substitui o anterior e a entrega antiga morre sem envio", { skip: !disposable }, async () => {
  const client = await fixtureClient();
  const first = await requestRecoveryCodeAndIssue(deps(), { phone: client.phone, ip: "198.51.100.10", requestId: "it-supersede" });
  const second = await requestRecoveryCodeAndIssue(deps(), { phone: client.phone, ip: "198.51.100.10", requestId: "it-supersede" });
  if (first.outcome !== "sent" || second.outcome !== "sent" || !first.deliveryId) return assert.fail("deveria enviar");
  let calls = 0;
  const outcome = await withWhatsApp(() => deliverNotificationNow(first.deliveryId!, { send: async () => { calls += 1; return { ok: true }; } }));
  assert.equal(outcome, "expired");
  assert.equal(calls, 0, "código substituído nunca chega ao provedor");
  const dead = await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: first.deliveryId } });
  assert.equal(dead.status, "DEAD");
  assert.equal(dead.message, REDACTED_DELIVERY_MESSAGE);
});

test("Postgres: payload selado vencido é apagado mesmo sem worker", { skip: !disposable }, async () => {
  const key = `password-reset-code:${randomUUID()}`;
  await prisma.notificationDelivery.create({ data: {
    id: randomUUID(), event: "PASSWORD_RESET", recipient: "5520900000031", recipientMasked: "*******0031",
    message: sealDeliveryPayload(keys, { text: "x", otp: "12345678" }, key), context: "teste", idempotencyKey: key,
    status: "PENDING", eligibleAt: new Date(), createdAt: new Date(Date.now() - 11 * 60_000),
  } });
  assert.ok(await redactExpiredSealedMessages() >= 1);
  assert.equal((await prisma.notificationDelivery.findUniqueOrThrow({ where: { idempotencyKey: key } })).message, REDACTED_DELIVERY_MESSAGE);
});

test("Postgres: link antigo usado invalida desafios de código ativos", { skip: !disposable }, async () => {
  const { resetClientPasswordWithToken } = await import("../lib/auth/client-password-reset-store");
  const client = await fixtureClient();
  const requested = await requestRecoveryCodeAndIssue(deps(), { phone: client.phone, ip: "198.51.100.11", requestId: "it-legacy" });
  if (requested.outcome !== "sent") return assert.fail("deveria enviar");
  const raw = randomUUID();
  await prisma.passwordResetToken.create({ data: { clientId: client.id, tokenHash: hashPasswordResetToken(raw), expiresAt: new Date(Date.now() + 30 * 60_000) } });
  assert.equal(await resetClientPasswordWithToken(raw, "senha-via-link-1"), true);
  const challenge = await prisma.passwordResetChallenge.findUniqueOrThrow({ where: { handleHash: hashRecoveryHandle(requested.handle) } });
  assert.ok(challenge.invalidatedAt);
});
