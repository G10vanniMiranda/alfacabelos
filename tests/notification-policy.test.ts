import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  computeRetryDelayMs,
  isDeliveryEligibleForClaim,
  isStaleProcessingLockRecoverable,
  maskRecipient,
} from "../lib/notifications/service";
import { normalizeWhatsAppPhone } from "../lib/notifications/phone";
import { sendWhatsAppOnce } from "../lib/notifications/whatsapp-provider";
import { isValidCronAuthorization } from "../lib/notifications/cron-auth";

const originalFetch = globalThis.fetch;
const originalEnv = {
  url: process.env.WHATSAPP_API_URL,
  token: process.env.WHATSAPP_API_TOKEN,
  timeout: process.env.WHATSAPP_REQUEST_TIMEOUT_MS,
  provider: process.env.WHATSAPP_PROVIDER,
  instanceId: process.env.WHATSAPP_INSTANCE_ID,
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries({
    WHATSAPP_API_URL: originalEnv.url,
    WHATSAPP_API_TOKEN: originalEnv.token,
    WHATSAPP_REQUEST_TIMEOUT_MS: originalEnv.timeout,
    WHATSAPP_PROVIDER: originalEnv.provider,
    WHATSAPP_INSTANCE_ID: originalEnv.instanceId,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("normalizes Brazilian WhatsApp numbers and rejects invalid recipients", () => {
  assert.equal(normalizeWhatsAppPhone("(69) 99999-1234"), "5569999991234");
  assert.equal(normalizeWhatsAppPhone("+55 69 99999-1234"), "5569999991234");
  assert.equal(normalizeWhatsAppPhone("123"), null);
  assert.equal(maskRecipient("5569999991234"), "*********1234");
});

test("cron endpoint authorization rejects missing or incorrect secrets", () => {
  assert.equal(isValidCronAuthorization(null, "correct-secret"), false);
  assert.equal(isValidCronAuthorization("Bearer wrong-secret", "correct-secret"), false);
  assert.equal(isValidCronAuthorization("Bearer correct-secret", undefined), false);
  assert.equal(isValidCronAuthorization("Bearer correct-secret", "correct-secret"), true);
});

test("retry backoff is exponential, capped and includes bounded jitter", () => {
  assert.equal(computeRetryDelayMs(1, () => 0), 30_000);
  assert.equal(computeRetryDelayMs(2, () => 1), 75_000);
  assert.equal(computeRetryDelayMs(20, () => 1), 3_600_000);
});

test("claim eligibility requires status, explicit eligibility, retry timing and attempts", () => {
  const now = new Date("2026-09-26T12:00:00.000Z");
  const eligibleAt = new Date("2026-09-26T11:59:00.000Z");
  const base = { attempts: 0, eligibleAt, nextRetryAt: null, lockedAt: null, lockedBy: null };

  assert.equal(isDeliveryEligibleForClaim({ ...base, status: "RETRY", eligibleAt: null }, now, 8), false);
  assert.equal(isDeliveryEligibleForClaim({ ...base, status: "DEAD" }, now, 8), false);
  assert.equal(isDeliveryEligibleForClaim({ ...base, status: "PENDING" }, now, 8), true);
  assert.equal(isDeliveryEligibleForClaim({ ...base, status: "PENDING", eligibleAt: null }, now, 8), false);
  assert.equal(isDeliveryEligibleForClaim({
    ...base,
    status: "RETRY",
    nextRetryAt: new Date("2026-09-26T12:01:00.000Z"),
  }, now, 8), false);
  assert.equal(isDeliveryEligibleForClaim({
    ...base,
    status: "RETRY",
    nextRetryAt: new Date("2026-09-26T11:59:30.000Z"),
  }, now, 8), true);
  assert.equal(isDeliveryEligibleForClaim({ ...base, status: "PENDING", attempts: 8 }, now, 8), false);
  assert.equal(isDeliveryEligibleForClaim({
    ...base,
    status: "PROCESSING",
    lockedAt: new Date("2026-09-26T11:56:00.000Z"),
  }, now, 8), false);
  assert.equal(isDeliveryEligibleForClaim({
    ...base,
    status: "PROCESSING",
    lockedAt: new Date("2026-09-26T11:54:00.000Z"),
  }, now, 8), false);
  assert.equal(isStaleProcessingLockRecoverable({
    ...base,
    status: "PROCESSING",
    lockedAt: new Date("2026-09-26T11:54:00.000Z"),
  }, now, 8), true);
  assert.equal(isStaleProcessingLockRecoverable({
    ...base,
    status: "PROCESSING",
    eligibleAt: null,
    lockedAt: new Date("2026-09-26T11:54:00.000Z"),
  }, now, 8), false);
});

test("provider classifies 429 and 5xx as transient without inline retries", async () => {
  process.env.WHATSAPP_API_URL = "https://provider.test/messages";
  process.env.WHATSAPP_API_TOKEN = "token";
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response("{}", { status: 429 }); };
  const throttled = await sendWhatsAppOnce({ to: "(69) 99999-1234", message: "Oi", context: "test", idempotencyKey: "key" });
  assert.deepEqual(throttled, { ok: false, retryable: true, category: "provider_transient", error: "WhatsApp provider returned HTTP 429" });
  assert.equal(calls, 1);

  globalThis.fetch = async () => new Response("{}", { status: 503 });
  const unavailable = await sendWhatsAppOnce({ to: "(69) 99999-1234", message: "Oi", context: "test", idempotencyKey: "key" });
  assert.equal(unavailable.ok, false);
  if (!unavailable.ok) assert.equal(unavailable.retryable, true);
});

test("provider classifies invalid input and auth failures as permanent", async () => {
  process.env.WHATSAPP_API_URL = "https://provider.test/messages";
  process.env.WHATSAPP_API_TOKEN = "token";
  const invalid = await sendWhatsAppOnce({ to: "123", message: "Oi", context: "test", idempotencyKey: "key" });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.category, "invalid_recipient");

  globalThis.fetch = async () => new Response("{}", { status: 401 });
  const unauthorized = await sendWhatsAppOnce({ to: "(69) 99999-1234", message: "Oi", context: "test", idempotencyKey: "key" });
  assert.equal(unauthorized.ok, false);
  if (!unauthorized.ok) {
    assert.equal(unauthorized.retryable, false);
    assert.equal(unauthorized.category, "authentication");
  }
});

test("provider enforces an explicit timeout", async () => {
  process.env.WHATSAPP_API_URL = "https://provider.test/messages";
  process.env.WHATSAPP_API_TOKEN = "token";
  process.env.WHATSAPP_REQUEST_TIMEOUT_MS = "1000";
  globalThis.fetch = (_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
  });
  const result = await sendWhatsAppOnce({ to: "(69) 99999-1234", message: "Oi", context: "test", idempotencyKey: "key" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.category, "timeout");
});

test("provider Evolution usa contrato explicito e captura o id retornado", async () => {
  process.env.WHATSAPP_PROVIDER = "evolution";
  process.env.WHATSAPP_API_URL = "https://gateway.example.test/message/sendText/{instanceId}";
  process.env.WHATSAPP_INSTANCE_ID = "alfa-homolog";
  process.env.WHATSAPP_API_TOKEN = "evolution-key";

  let requestedUrl = "";
  let requestedInit: RequestInit | undefined;
  globalThis.fetch = async (url, init) => {
    requestedUrl = String(url);
    requestedInit = init;
    return Response.json({ key: { id: "MSG-123" } }, { status: 201 });
  };

  const result = await sendWhatsAppOnce({
    to: "(69) 99350-3633",
    message: "Recuperacao",
    context: "password-reset",
    idempotencyKey: "password-reset:test",
  });

  assert.deepEqual(result, { ok: true, providerMessageId: "MSG-123" });
  assert.equal(requestedUrl, "https://gateway.example.test/message/sendText/alfa-homolog");
  const headers = new Headers(requestedInit?.headers);
  assert.equal(headers.get("apikey"), "evolution-key");
  assert.equal(headers.get("authorization"), null);
  assert.deepEqual(JSON.parse(String(requestedInit?.body)), {
    number: "5569993503633",
    text: "Recuperacao",
  });
});
