import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateOperationalAlerts } from "../lib/observability/alerts";
import { dispatchOperationalAlerts, type AlertDeliveryDependencies } from "../lib/observability/alert-delivery";
import { platformRequestId, requestIdFromHeaders } from "../lib/observability/context";
import { checkCriticalConfiguration, checkDatabaseHealth, classifyWorkerHeartbeat } from "../lib/observability/health";
import { logger, maskLogPhone, sanitizeAuditMetadata, sanitizeLogValue } from "../lib/observability/logger";
import { deriveNotificationQueueDepths } from "../lib/observability/metrics";

test("outbox backlog and currently eligible depth are independent metrics", () => {
  assert.deepEqual(deriveNotificationQueueDepths({ pending: 4, retry: 3, eligibleNow: 2 }), {
    backlog: 7,
    eligibleNow: 2,
  });
});

test("structured logger redacts secrets, credentials and masks phone numbers", () => {
  const previous = console.info;
  let output = "";
  console.info = (value?: unknown) => { output = String(value); };
  try {
    logger.info("security.redaction_test", {
      authorization: "Bearer secret-token",
      customerPhone: "(69) 99999-1234",
      database: "postgresql://user:password@database.example/app",
      nested: { apiKey: "top-secret" },
    });
  } finally {
    console.info = previous;
  }
  const entry = JSON.parse(output) as Record<string, unknown>;
  assert.equal(entry.event, "security.redaction_test");
  assert.equal(entry.authorization, "[REDACTED]");
  assert.equal(entry.customerPhone, "*******1234");
  assert.equal(entry.database, "postgresql://[REDACTED]@database.example/app");
  assert.deepEqual(entry.nested, { apiKey: "[REDACTED]" });
  assert.doesNotMatch(output, /secret-token|user:password|top-secret/);
});

test("audit metadata omits direct PII and sanitizes nested secrets", () => {
  assert.deepEqual(sanitizeAuditMetadata({
    customerName: "Pessoa",
    email: "person@example.com",
    actionScope: "future",
    credential: "never-log-this",
    details: { customerName: "Nested Person", observations: "private", safeCount: 2 },
  }), { actionScope: "future", credential: "[REDACTED]", details: { safeCount: 2 } });
  assert.equal(maskLogPhone("123"), "****");
  const safeError = JSON.stringify(sanitizeLogValue(new Error("person@example.com +5569999991234 abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN"), "error"));
  assert.doesNotMatch(safeError, /person@example|999991234|abcdefghijklmnopqrstuvwxyz/);
});

test("request correlation accepts bounded IDs and rejects hostile values", () => {
  assert.equal(requestIdFromHeaders(new Headers({ "x-request-id": "req-123_abc" })), "req-123_abc");
  assert.notEqual(requestIdFromHeaders(new Headers({ "x-request-id": "contains spaces and ?" })), "contains spaces and ?");
  assert.notEqual(platformRequestId(new Headers({ "x-request-id": "client-controlled" })), "client-controlled");
});

test("database health reports success, failure and timeout without exception details", async () => {
  const healthy = await checkDatabaseHealth(async () => 1, 50);
  assert.equal(healthy.status, "healthy");
  assert.equal(typeof healthy.latencyMs, "number");
  assert.deepEqual(await checkDatabaseHealth(async () => { throw new Error("password leaked"); }, 50), {
    status: "unhealthy", latencyMs: null, errorCode: "unavailable",
  });
  const timeout = await checkDatabaseHealth(() => new Promise(() => undefined), 5);
  assert.deepEqual(timeout, { status: "unhealthy", latencyMs: 5, errorCode: "timeout" });
});

test("worker heartbeat distinguishes healthy, failed, stale and never-run workers", () => {
  const now = new Date("2026-08-01T12:00:00.000Z");
  assert.deepEqual(classifyWorkerHeartbeat(null, now, 900), { status: "unknown", ageSeconds: null });
  assert.equal(classifyWorkerHeartbeat({ status: "success", lastSuccessAt: new Date("2026-08-01T11:55:00Z"), lastFailureAt: null }, now, 900).status, "healthy");
  assert.equal(classifyWorkerHeartbeat({ status: "failure", lastSuccessAt: new Date("2026-08-01T11:55:00Z"), lastFailureAt: new Date("2026-08-01T11:58:00Z") }, now, 900).status, "degraded");
  assert.equal(classifyWorkerHeartbeat({ status: "success", lastSuccessAt: new Date("2026-08-01T11:00:00Z"), lastFailureAt: null }, now, 900).status, "unhealthy");
});

test("operational alert thresholds detect outbox, worker and database incidents", () => {
  const alerts = evaluateOperationalAlerts({
    backlog: 51,
    oldestPendingAgeSeconds: 901,
    newDead24h: 1,
    workerAgeSeconds: null,
    databaseLatencyMs: 501,
  });
  assert.deepEqual(alerts.map((alert) => alert.code), [
    "outbox.backlog", "outbox.oldest_pending", "outbox.new_dead", "worker.stale", "database.latency",
  ]);
});

test("external alerts use a sanitized webhook payload and durable cooldown claim", async () => {
  const sent: Array<{ url: string; token?: string; body: Record<string, unknown> }> = [];
  const claimed: string[] = [];
  const dependencies: AlertDeliveryDependencies = {
    claim: async ({ code }) => { claimed.push(code); return true; },
    send: async (input) => { sent.push(input); return { ok: true, status: 202 }; },
  };
  const result = await dispatchOperationalAlerts(
    [{ code: "outbox.new_dead", severity: "critical", value: 1, threshold: 0 }],
    {
      requestId: "req-alert-1",
      now: new Date("2026-09-04T12:00:00.000Z"),
      env: {
        APP_ENV: "homologation",
        ALERT_WEBHOOK_URL: "https://alerts.example.test/hooks/alfa",
        ALERT_WEBHOOK_TOKEN: "never-in-payload",
        ALERT_COOLDOWN_SECONDS: "600",
      },
    },
    dependencies,
  );
  assert.deepEqual(claimed, ["outbox.new_dead"]);
  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.url, "https://alerts.example.test/hooks/alfa");
  assert.equal(sent[0]?.token, "never-in-payload");
  assert.equal(sent[0]?.body.code, "outbox.new_dead");
  assert.equal(sent[0]?.body.environment, "homologation");
  assert.doesNotMatch(JSON.stringify(sent[0]?.body), /never-in-payload/);
  assert.deepEqual(result, [{ code: "outbox.new_dead", status: "sent", httpStatus: 202 }]);
});

test("external alert delivery suppresses a claimed cooldown and reports disabled or failed receivers", async () => {
  let sendCount = 0;
  const suppressedDependencies: AlertDeliveryDependencies = {
    claim: async () => false,
    send: async () => { sendCount += 1; return { ok: true, status: 200 }; },
  };
  const alert = { code: "worker.stale", severity: "critical" as const, value: null, threshold: 900 };
  assert.deepEqual(await dispatchOperationalAlerts([alert], {
    requestId: "req-alert-2",
    env: { ALERT_WEBHOOK_URL: "https://alerts.example.test/hook" },
  }, suppressedDependencies), [{ code: "worker.stale", status: "suppressed" }]);
  assert.equal(sendCount, 0);

  assert.deepEqual(await dispatchOperationalAlerts([alert], {
    requestId: "req-alert-3",
    env: {},
  }, suppressedDependencies), [{ code: "worker.stale", status: "disabled" }]);

  const failingDependencies: AlertDeliveryDependencies = {
    claim: async () => true,
    send: async () => ({ ok: false, status: 503 }),
  };
  assert.deepEqual(await dispatchOperationalAlerts([alert], {
    requestId: "req-alert-4",
    env: { ALERT_WEBHOOK_URL: "https://alerts.example.test/hook" },
  }, failingDependencies), [{ code: "worker.stale", status: "failed", httpStatus: 503 }]);
});

test("database outage alerts can reach the receiver when durable deduplication is unavailable", async () => {
  let sendCount = 0;
  const dependencies: AlertDeliveryDependencies = {
    claim: async () => { throw new Error("database unavailable"); },
    send: async () => { sendCount += 1; return { ok: true, status: 204 }; },
  };
  assert.deepEqual(await dispatchOperationalAlerts([
    { code: "database.unavailable", severity: "critical", value: null, threshold: 0 },
  ], {
    requestId: "req-alert-database",
    env: { APP_ENV: "homologation", ALERT_WEBHOOK_URL: "https://alerts.example.test/hook" },
    allowUndeduplicatedOnClaimFailure: true,
  }, dependencies), [{ code: "database.unavailable", status: "sent", httpStatus: 204, deduplication: "degraded" }]);
  assert.equal(sendCount, 1);
});

test("external alert receiver rejects local and private network targets", async () => {
  let claimCount = 0;
  const dependencies: AlertDeliveryDependencies = {
    claim: async () => { claimCount += 1; return true; },
    send: async () => ({ ok: true, status: 200 }),
  };
  const alert = { code: "worker.stale", severity: "critical" as const, value: null, threshold: 900 };
  for (const receiver of ["http://alerts.example.test/hook", "https://localhost/hook", "https://127.0.0.1/hook", "https://10.20.30.40/hook", "https://192.168.1.10/hook"]) {
    assert.deepEqual(await dispatchOperationalAlerts([alert], {
      requestId: "req-alert-private",
      env: { ALERT_WEBHOOK_URL: receiver },
    }, dependencies), [{ code: "worker.stale", status: "failed", errorCode: "invalid_receiver" }]);
  }
  assert.equal(claimCount, 0);
});

test("strict runtime configuration fails safely and accepts isolated homologation", () => {
  const invalid = checkCriticalConfiguration({
    VERCEL_ENV: "production",
    DATABASE_URL: "postgresql://postgres.prodref@pooler.supabase.com:6543/postgres",
    DIRECT_URL: "postgresql://postgres.prodref@db.prodref.supabase.co:5432/postgres",
    APP_URL: "http://homolog.example.test",
    CRON_SECRET: "short",
    SUPABASE_URL: "https://prodref.supabase.co",
    SUPABASE_PROJECT_REF: "homologref",
    SUPABASE_SERVICE_ROLE_KEY: "configured",
    SUPABASE_STORAGE_BUCKET: "alfa-homolog",
  });
  assert.equal(invalid.status, "unhealthy");
  assert.deepEqual(invalid.issues.sort(), [
    "alert_receiver",
    "application_environment",
    "application_url_security",
    "notification_worker_auth",
    "supabase_identity",
  ]);

  assert.deepEqual(checkCriticalConfiguration({
    APP_ENV: "homologation",
    VERCEL_ENV: "production",
    DATABASE_URL: "postgresql://postgres.homologref@pooler.supabase.com:6543/postgres",
    DIRECT_URL: "postgresql://postgres.homologref@db.homologref.supabase.co:5432/postgres",
    APP_URL: "https://alfa-homolog.example.test",
    CRON_SECRET: "homolog-cron-secret-2026",
    SUPABASE_URL: "https://homologref.supabase.co",
    SUPABASE_PROJECT_REF: "homologref",
    SUPABASE_SERVICE_ROLE_KEY: "configured",
    SUPABASE_STORAGE_BUCKET: "alfa-homolog",
    PRODUCTION_SUPABASE_PROJECT_REF: "prodref",
    PRODUCTION_APP_HOST: "alfa.example.test",
    PRODUCTION_STORAGE_BUCKET: "barber",
    ALERT_WEBHOOK_URL: "https://alerts.example.test/alfa-homolog",
    WHATSAPP_ENABLED: "false",
  }).status, "healthy");
});

test("homologation fails closed when production identifiers are missing or reused", () => {
  const base = {
    APP_ENV: "homologation",
    VERCEL_ENV: "production",
    DATABASE_URL: "postgresql://postgres.prodref@pooler.supabase.com:6543/postgres",
    DIRECT_URL: "postgresql://postgres.prodref@db.prodref.supabase.co:5432/postgres",
    APP_URL: "https://alfa.example.test",
    CRON_SECRET: "homolog-cron-secret-2026",
    SUPABASE_URL: "https://prodref.supabase.co",
    SUPABASE_PROJECT_REF: "prodref",
    SUPABASE_SERVICE_ROLE_KEY: "configured",
    SUPABASE_STORAGE_BUCKET: "barber",
    ALERT_WEBHOOK_URL: "https://alerts.example.test/alfa-homolog",
    WHATSAPP_ENABLED: "false",
  };

  assert.ok(checkCriticalConfiguration(base).issues.includes("production_identity_baseline"));

  const reused = checkCriticalConfiguration({
    ...base,
    PRODUCTION_SUPABASE_PROJECT_REF: "prodref",
    PRODUCTION_APP_HOST: "alfa.example.test",
    PRODUCTION_STORAGE_BUCKET: "barber",
  });
  assert.equal(reused.status, "unhealthy");
  assert.deepEqual(reused.issues.filter((issue) => issue.startsWith("production_")).sort(), [
    "production_application",
    "production_database",
    "production_storage",
    "production_supabase_reference",
  ]);

  const reusedEvolution = checkCriticalConfiguration({
    ...base,
    DATABASE_URL: "postgresql://postgres.homologref@pooler.supabase.com:6543/postgres",
    DIRECT_URL: "postgresql://postgres.homologref@db.homologref.supabase.co:5432/postgres",
    APP_URL: "https://alfa-homolog.example.test",
    SUPABASE_URL: "https://homologref.supabase.co",
    SUPABASE_PROJECT_REF: "homologref",
    SUPABASE_STORAGE_BUCKET: "alfa-homolog",
    PRODUCTION_SUPABASE_PROJECT_REF: "prodref",
    PRODUCTION_APP_HOST: "alfa.example.test",
    PRODUCTION_STORAGE_BUCKET: "barber",
    WHATSAPP_ENABLED: "true",
    WHATSAPP_API_URL: "https://evolution.example.test/message/sendText/{instanceId}",
    WHATSAPP_API_TOKEN: "configured",
    WHATSAPP_INSTANCE_ID: "alfa-production",
    PRODUCTION_EVOLUTION_INSTANCE_ID: "alfa-production",
  });
  assert.ok(reusedEvolution.issues.includes("production_evolution_instance"));

});
