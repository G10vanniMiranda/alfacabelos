import assert from "node:assert/strict";
import test from "node:test";
import { isRetryable, msUntilNextTick, runTick, schedulerConfig } from "../scripts/notification-scheduler.mjs";

const SECRET = "s".repeat(32);

test("scheduler config requires a worker URL and a strong secret, and bounds the interval", () => {
  assert.throws(() => schedulerConfig({ CRON_SECRET: SECRET }), /NOTIFICATION_WORKER_URL/);
  assert.throws(() => schedulerConfig({ NOTIFICATION_WORKER_URL: "http://app:3000/x", CRON_SECRET: "short" }), /CRON_SECRET/);
  assert.throws(() => schedulerConfig({ NOTIFICATION_WORKER_URL: "http://app:3000/x", CRON_SECRET: "s".repeat(31) }), /CRON_SECRET/);
  assert.throws(() => schedulerConfig({ NOTIFICATION_WORKER_URL: "file:///etc/passwd", CRON_SECRET: SECRET }), /http/);
  const base = { NOTIFICATION_WORKER_URL: "http://app:3000/api/internal/notifications/process", CRON_SECRET: SECRET };
  assert.equal(schedulerConfig(base).intervalSeconds, 300);
  assert.equal(schedulerConfig({ ...base, NOTIFICATION_SCHEDULER_INTERVAL_SECONDS: "5" }).intervalSeconds, 60);
  assert.equal(schedulerConfig({ ...base, NOTIFICATION_SCHEDULER_INTERVAL_SECONDS: "99999" }).intervalSeconds, 3600);
});

test("ticks align to the wall clock every five minutes", () => {
  const fiveMinutes = 300_000;
  assert.equal(msUntilNextTick(Date.UTC(2026, 10, 13, 10, 0, 0), 300), fiveMinutes);
  assert.equal(msUntilNextTick(Date.UTC(2026, 10, 13, 10, 4, 30), 300), 30_000);
});

test("only network failures, timeouts and 5xx are retried, at most once", async () => {
  assert.equal(isRetryable({ status: 0 }), true);
  assert.equal(isRetryable({ status: 503 }), true);
  assert.equal(isRetryable({ status: 401 }), false);
  assert.equal(isRetryable({ status: 429 }), false);

  const config = { url: "http://app:3000/api/internal/notifications/process", secret: SECRET };
  const seen: string[] = [];
  const logs: string[] = [];
  let calls = 0;
  const failing = async (_url: string, init: RequestInit) => {
    calls += 1;
    seen.push(new Headers(init.headers).get("authorization") ?? "");
    return new Response("{}", { status: 503 });
  };
  const result = await runTick(config, { fetchImpl: failing, sleep: async () => {}, log: (line: string) => logs.push(line) });
  assert.equal(calls, 2);
  assert.equal(result?.status, 503);
  assert.deepEqual(seen, [`Bearer ${SECRET}`, `Bearer ${SECRET}`]);
  assert.ok(logs.every((line) => !line.includes(SECRET)), "secret must never be logged");

  calls = 0;
  const unauthorized = async () => { calls += 1; return new Response("{}", { status: 401 }); };
  await runTick(config, { fetchImpl: unauthorized, sleep: async () => {}, log: () => {} });
  assert.equal(calls, 1);

  const ok = async () => new Response(JSON.stringify({ ok: true, claimed: 3, sent: 2, retry: 1, dead: 0, remindersEnqueued: 1, message: "x" }), { status: 200 });
  const okLogs: string[] = [];
  const success = await runTick(config, { fetchImpl: ok, sleep: async () => {}, log: (line: string) => okLogs.push(line) });
  assert.equal(success?.sent, 2);
  assert.equal(JSON.parse(okLogs[0]).event, "notification.scheduler.tick");
});
