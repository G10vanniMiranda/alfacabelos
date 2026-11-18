import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { readCanaryConfig, CANARY_MAX_MESSAGES_CAP } from "../lib/notifications/canary-config";
import { authorizeWhatsAppSend, evaluateSendPolicy } from "../lib/notifications/send-authorization";
import { sendWhatsAppOnce } from "../lib/notifications/whatsapp-provider";
import { checkCriticalConfiguration } from "../lib/observability/health";

// Synthetic numbers only.
const OPERATOR = "5569999990001";
const OWNER = "5569999990002";
const OUTSIDER = "5569999990003";
const now = new Date("2026-11-17T12:00:00.000Z");
const inOneHour = "2026-11-17T13:00:00.000Z";

const homologRef = "homologrefhomologref";
const productionRef = "prodrefprodrefprodre";

const base = {
  DATABASE_URL: `postgresql://postgres.${homologRef}@pooler.supabase.com:6543/postgres`,
  DIRECT_URL: `postgresql://postgres@db.${homologRef}.supabase.co:5432/postgres`,
  APP_URL: "https://homolog.alfa.example.test",
  CRON_SECRET: "cron-secret-0123456789",
  SUPABASE_URL: `https://${homologRef}.supabase.co`,
  SUPABASE_PROJECT_REF: homologRef,
  SUPABASE_SERVICE_ROLE_KEY: "configured",
  SUPABASE_STORAGE_BUCKET: "alfa-homolog",
  PASSWORD_RESET_SECRET: "s".repeat(64),
  WHATSAPP_ENABLED: "true",
  WHATSAPP_PROVIDER: "evolution",
  WHATSAPP_API_URL: "https://evolution.example.test/message/sendText/{instanceId}",
  WHATSAPP_API_TOKEN: "instance-token",
  WHATSAPP_INSTANCE_ID: "Shop Instance",
  PRODUCTION_EVOLUTION_INSTANCE_ID: "Shop Instance",
};

const homologation = {
  ...base,
  APP_ENV: "homologation",
  PRODUCTION_SUPABASE_PROJECT_REF: productionRef,
  PRODUCTION_APP_HOST: "alfa.example.test",
  PRODUCTION_STORAGE_BUCKET: "barber",
};

const canary = {
  ...homologation,
  WHATSAPP_CANARY_ENABLED: "true",
  WHATSAPP_CANARY_ROUND_ID: "round-01",
  WHATSAPP_CANARY_INSTANCE_ID: "Shop Instance",
  WHATSAPP_CANARY_EXPIRES_AT: inOneHour,
  WHATSAPP_CANARY_MAX_MESSAGES: "12",
  WHATSAPP_CANARY_ALLOWLIST: "+55 (69) 99999-0001, 69999990002",
};

const production = {
  ...base,
  APP_ENV: "production",
  APP_URL: "https://alfa.example.test",
  DATABASE_URL: `postgresql://postgres.${productionRef}@pooler.supabase.com:6543/postgres`,
  DIRECT_URL: `postgresql://postgres@db.${productionRef}.supabase.co:5432/postgres`,
  SUPABASE_URL: `https://${productionRef}.supabase.co`,
  SUPABASE_PROJECT_REF: productionRef,
  SUPABASE_STORAGE_BUCKET: "barber",
  PRODUCTION_SUPABASE_PROJECT_REF: productionRef,
};

const policy = (env: Record<string, string | undefined>, to = OPERATOR, at = now) =>
  evaluateSendPolicy({ to, provider: "evolution", env, now: at });
const reason = (result: ReturnType<typeof policy>) => (result.allowed ? "allowed" : result.reason);

test("send policy blocks when WhatsApp is globally disabled, in any environment", () => {
  assert.equal(reason(policy({ ...production, WHATSAPP_ENABLED: "false" })), "whatsapp_disabled");
  assert.equal(reason(policy({ ...canary, WHATSAPP_ENABLED: "false" })), "whatsapp_disabled");
});

test("send policy never allows development, test or unset environments", () => {
  for (const APP_ENV of [undefined, "", "development", "test", "staging", "preview"]) {
    assert.equal(reason(policy({ ...canary, APP_ENV })), "environment_not_allowed", String(APP_ENV));
  }
});

test("production sends only with healthy configuration and the explicitly authorized instance", () => {
  assert.deepEqual(policy(production), { allowed: true, mode: "production" });
  assert.match(reason(policy({ ...production, WHATSAPP_INSTANCE_ID: "Other" })), /whatsapp_instance_identity/);
  assert.match(reason(policy({ ...production, PRODUCTION_EVOLUTION_INSTANCE_ID: undefined })), /whatsapp_instance_identity/);
  assert.match(reason(policy({ ...production, PASSWORD_RESET_SECRET: undefined })), /password_recovery_secret/);
  assert.match(reason(policy({ ...production, WHATSAPP_API_TOKEN: "" })), /whatsapp_provider/);
});

test("a non-production database labelled production cannot send", () => {
  // e.g. the staging stack started with APP_ENV=production by mistake
  const relabelled = { ...homologation, APP_ENV: "production" };
  assert.match(reason(policy(relabelled)), /whatsapp_production_identity/);
  assert.match(reason(policy({ ...production, PRODUCTION_SUPABASE_PROJECT_REF: undefined })), /whatsapp_production_identity/);
});

test("canary settings are refused in production (no generic bypass variable)", () => {
  const leaked = { ...production, WHATSAPP_CANARY_ENABLED: "true", WHATSAPP_CANARY_ALLOWLIST: OPERATOR };
  assert.match(reason(policy(leaked)), /whatsapp_canary_environment/);
  assert.ok(checkCriticalConfiguration(leaked, now).issues.includes("whatsapp_canary_environment"));
  assert.match(reason(policy({ ...production, WHATSAPP_CANARY_ENABLED: "yes" })), /whatsapp_canary_environment/);
  assert.deepEqual(policy({ ...production, WHATSAPP_CANARY_ENABLED: "false" }), { allowed: true, mode: "production" });
});

test("homologation never sends without an active canary", () => {
  assert.match(reason(policy(homologation)), /production_evolution_instance/);
  assert.equal(reason(policy({ ...homologation, WHATSAPP_INSTANCE_ID: "Other", PRODUCTION_EVOLUTION_INSTANCE_ID: "Shop Instance" })), "canary_disabled");
});

test("an active canary allows only allowlisted, normalized recipients", () => {
  const allowed = policy(canary, OPERATOR);
  assert.ok(allowed.allowed && allowed.mode === "canary");
  assert.ok(policy(canary, OWNER).allowed);
  assert.equal(reason(policy(canary, OUTSIDER)), "recipient_not_allowlisted");
  assert.equal(reason(policy(canary, "")), "recipient_not_allowlisted");
  assert.ok(checkCriticalConfiguration(canary, now).status === "healthy");
});

test("an expired canary blocks and readiness flags the production instance again", () => {
  const later = new Date("2026-11-17T13:00:00.000Z");
  assert.match(reason(policy(canary, OPERATOR, later)), /production_evolution_instance/);
  assert.equal(reason(policy({ ...canary, WHATSAPP_INSTANCE_ID: "Other", WHATSAPP_CANARY_INSTANCE_ID: "Other" }, OPERATOR, later)), "canary_expired");
  assert.ok(checkCriticalConfiguration(canary, later).issues.includes("production_evolution_instance"));
});

test("canary bound to another instance does not cover the configured one", () => {
  assert.match(reason(policy({ ...canary, WHATSAPP_CANARY_INSTANCE_ID: "Other" })), /production_evolution_instance/);
  assert.equal(
    reason(policy({ ...canary, WHATSAPP_INSTANCE_ID: "Lab", PRODUCTION_EVOLUTION_INSTANCE_ID: "Shop Instance" })),
    "canary_instance_mismatch",
  );
});

test("malformed canary settings are rejected as a whole", () => {
  const invalid: Array<[Record<string, string | undefined>, string]> = [
    [{ WHATSAPP_CANARY_ALLOWLIST: "*" }, "canary_allowlist"],
    [{ WHATSAPP_CANARY_ALLOWLIST: "5569*" }, "canary_allowlist"],
    [{ WHATSAPP_CANARY_ALLOWLIST: "" }, "canary_allowlist"],
    [{ WHATSAPP_CANARY_ALLOWLIST: `${OPERATOR},123` }, "canary_allowlist"],
    [{ WHATSAPP_CANARY_ALLOWLIST: `${OPERATOR},` }, "canary_allowlist"],
    [{ WHATSAPP_CANARY_ALLOWLIST: "+1 202 555 0100" }, "canary_allowlist"],
    [{ WHATSAPP_CANARY_ALLOWLIST: Array.from({ length: 6 }, (_, i) => `556999999000${i}`).join(",") }, "canary_allowlist"],
    [{ WHATSAPP_CANARY_MAX_MESSAGES: "0" }, "canary_max_messages"],
    [{ WHATSAPP_CANARY_MAX_MESSAGES: String(CANARY_MAX_MESSAGES_CAP + 1) }, "canary_max_messages"],
    [{ WHATSAPP_CANARY_MAX_MESSAGES: "1e1" }, "canary_max_messages"],
    [{ WHATSAPP_CANARY_EXPIRES_AT: "2026-11-17 13:00" }, "canary_expiry"],
    [{ WHATSAPP_CANARY_EXPIRES_AT: "2026-11-19T13:00:00Z" }, "canary_expiry_too_far"],
    [{ WHATSAPP_CANARY_ROUND_ID: "" }, "canary_round_id"],
    [{ WHATSAPP_CANARY_ROUND_ID: "a b" }, "canary_round_id"],
    [{ WHATSAPP_CANARY_INSTANCE_ID: " " }, "canary_instance"],
  ];
  for (const [override, expected] of invalid) {
    const state = readCanaryConfig({ ...canary, ...override }, now);
    assert.deepEqual(state, { status: "invalid", reason: expected }, JSON.stringify(override));
    assert.match(reason(policy({ ...canary, ...override })), /whatsapp_canary_configuration/);
  }
});

test("configuration changes take effect on the next send", () => {
  const env: Record<string, string | undefined> = { ...canary };
  assert.ok(policy(env).allowed);
  env.WHATSAPP_CANARY_ENABLED = "false";
  assert.match(reason(policy(env)), /production_evolution_instance/);
});

test("the round budget is enforced and a database failure blocks without consuming it", async () => {
  const used = { value: 0 };
  const reserve = async () => (used.value < 2 ? ++used.value : null);
  const send = (to: string) => authorizeWhatsAppSend({ to, provider: "evolution", context: "test" }, { env: canary, now, reserve });
  assert.deepEqual(await send(OPERATOR), { allowed: true, mode: "canary", roundId: "round-01", slot: 1 });
  assert.deepEqual(await send(OWNER), { allowed: true, mode: "canary", roundId: "round-01", slot: 2 });
  assert.deepEqual(await send(OPERATOR), { allowed: false, reason: "canary_limit_reached", retryable: false });
  // Outside the allowlist the budget is never touched.
  assert.deepEqual(await send(OUTSIDER), { allowed: false, reason: "recipient_not_allowlisted", retryable: false });
  assert.equal(used.value, 2);

  const failing = await authorizeWhatsAppSend({ to: OPERATOR, provider: "evolution", context: "test" }, {
    env: canary, now, reserve: async () => { throw new Error("connection refused"); },
  });
  assert.deepEqual(failing, { allowed: false, reason: "canary_authorization_unavailable", retryable: true });
});

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
});

test("a blocked send never reaches the provider", async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return Response.json({ key: { id: "x" } }); };
  for (const env of [
    homologation,
    { ...canary, WHATSAPP_CANARY_EXPIRES_AT: "2026-01-01T00:00:00Z" },
    { ...production, APP_ENV: "development" },
    { ...production, WHATSAPP_CANARY_ENABLED: "true" },
  ]) {
    for (const key of Object.keys(process.env)) if (key.startsWith("WHATSAPP_") || key.startsWith("PRODUCTION_")) delete process.env[key];
    Object.assign(process.env, env);
    const result = await sendWhatsAppOnce({ to: "(69) 99999-0001", message: "Teste", context: "test", idempotencyKey: "k" });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.category, "send_blocked");
  }
  Object.assign(process.env, canary, { WHATSAPP_CANARY_EXPIRES_AT: new Date(Date.now() + 3_600_000).toISOString() });
  const outsider = await sendWhatsAppOnce({ to: "(69) 99999-0003", message: "Teste", context: "test", idempotencyKey: "k" });
  assert.deepEqual(outsider, { ok: false, retryable: false, category: "send_blocked", error: "WhatsApp send blocked: recipient_not_allowlisted" });
  assert.equal(calls, 0);
});

test("positive control: an allowed production send reaches the provider exactly once", async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return Response.json({ key: { id: "MSG-OK" } }, { status: 201 }); };
  for (const key of Object.keys(process.env)) if (key.startsWith("WHATSAPP_") || key.startsWith("PRODUCTION_")) delete process.env[key];
  Object.assign(process.env, production);
  const result = await sendWhatsAppOnce({ to: "(69) 99999-0001", message: "Teste", context: "test", idempotencyKey: "k" });
  assert.deepEqual(result, { ok: true, providerMessageId: "MSG-OK" });
  assert.equal(calls, 1);
});

test("canary round id is case-insensitive so a case change cannot reset the budget", () => {
  const state = readCanaryConfig({ ...canary, WHATSAPP_CANARY_ROUND_ID: "Round-01" }, now);
  assert.ok(state.status === "active" && state.config.roundId === "round-01");
});
