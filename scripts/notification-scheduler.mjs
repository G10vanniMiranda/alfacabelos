// Notification scheduler for the VPS deployment: calls the authenticated worker endpoint
// every NOTIFICATION_SCHEDULER_INTERVAL_SECONDS (default 300 = every 5 minutes, aligned to
// the wall clock). One request at a time, so ticks never overlap; the worker itself is
// idempotent (SKIP LOCKED claims + lease), so a late or repeated tick cannot double-send.
// Logs one JSON line per tick. Exits only on SIGTERM/SIGINT.

const DEFAULT_INTERVAL_SECONDS = 300;
const REQUEST_TIMEOUT_MS = 75_000; // worker maxDuration is 60 s
const RETRY_DELAY_MS = 20_000;
const MAX_ATTEMPTS = 2;

/** @param {Record<string, string | undefined>} [env] */
export function schedulerConfig(env = process.env) {
  const url = env.NOTIFICATION_WORKER_URL?.trim();
  const secret = env.CRON_SECRET?.trim();
  if (!url) throw new Error("NOTIFICATION_WORKER_URL is required");
  if (!secret || secret.length < 32) throw new Error("CRON_SECRET is required (32+ chars)");
  const parsed = new URL(url);
  if (!/^https?:$/.test(parsed.protocol)) throw new Error("NOTIFICATION_WORKER_URL must be http(s)");
  const interval = Number(env.NOTIFICATION_SCHEDULER_INTERVAL_SECONDS ?? DEFAULT_INTERVAL_SECONDS);
  const intervalSeconds = Number.isFinite(interval) ? Math.min(3600, Math.max(60, Math.trunc(interval))) : DEFAULT_INTERVAL_SECONDS;
  return { url: parsed.toString(), secret, intervalSeconds };
}

/** Milliseconds until the next wall-clock boundary of `intervalSeconds` (e.g. :00, :05, :10). */
/** @param {number} now @param {number} intervalSeconds */
export function msUntilNextTick(now, intervalSeconds) {
  const period = intervalSeconds * 1000;
  return period - (now % period);
}

/** Only failures that can succeed on an immediate retry: network errors, timeouts and 5xx. */
/** @param {{ status: number }} result */
export function isRetryable(result) {
  return result.status === 0 || result.status >= 500;
}

/** @typedef {(url: string, init: RequestInit) => Promise<Response>} FetchLike */
/** @param {{ url: string, secret: string }} config @param {FetchLike} [fetchImpl] */
export async function callWorker({ url, secret }, fetchImpl = fetch) {
  const startedAt = Date.now();
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { authorization: `Bearer ${secret}`, "user-agent": "alfa-notification-scheduler" },
      // Never forward the bearer token to a redirect target.
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body = await response.json().catch(() => ({}));
    return {
      status: response.status,
      durationMs: Date.now() - startedAt,
      // Counters only: the worker response carries no message content or recipients.
      claimed: body.claimed, sent: body.sent, retry: body.retry, dead: body.dead,
      remindersEnqueued: body.remindersEnqueued,
    };
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    return { status: 0, durationMs: Date.now() - startedAt, error: name === "TimeoutError" ? "timeout" : "network" };
  }
}

/**
 * @param {{ url: string, secret: string }} config
 * @param {{ fetchImpl?: FetchLike, sleep?: (ms: number) => Promise<unknown>, log?: (line: string) => void }} [options]
 */
export async function runTick(config, { fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = console.log } = {}) {
  let attempt = 1;
  for (;;) {
    const result = await callWorker(config, fetchImpl);
    const ok = result.status >= 200 && result.status < 300;
    log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: ok ? "info" : "error",
      event: ok ? "notification.scheduler.tick" : "notification.scheduler.tick_failed",
      attempt,
      ...result,
    }));
    if (ok || !isRetryable(result) || attempt >= MAX_ATTEMPTS) return result;
    attempt += 1;
    await sleep(RETRY_DELAY_MS);
  }
}

export const HEARTBEAT_PATH = "/tmp/alfa-scheduler-heartbeat.json";

/** Liveness of the loop itself (not of the worker): written at start and after every tick. */
/** @param {number} now @param {number} intervalSeconds @param {number | undefined} lastStatus */
export function heartbeatContent(now, intervalSeconds, lastStatus) {
  // Longest legitimate gap: one interval plus a tick with retry (2 x 75 s + 20 s), with margin.
  return JSON.stringify({ at: now, staleAfterMs: (intervalSeconds * 2 + 120) * 1000, lastStatus });
}

/** @param {string} content @param {number} now */
export function isHeartbeatFresh(content, now) {
  try {
    const { at, staleAfterMs } = JSON.parse(content);
    return Number.isFinite(at) && Number.isFinite(staleAfterMs) && now - at >= 0 && now - at < staleAfterMs;
  } catch {
    return false;
  }
}

async function writeHeartbeat(content) {
  const { writeFile } = await import("node:fs/promises");
  // A read-only root without a writable /tmp only loses the healthcheck signal, never the schedule.
  await writeFile(HEARTBEAT_PATH, content).catch(() => {});
}

async function healthcheck() {
  const { readFile } = await import("node:fs/promises");
  const content = await readFile(HEARTBEAT_PATH, "utf8").catch(() => "");
  process.exit(isHeartbeatFresh(content, Date.now()) ? 0 : 1);
}

async function main() {
  const config = schedulerConfig();
  await writeHeartbeat(heartbeatContent(Date.now(), config.intervalSeconds, undefined));
  let stopping = false;
  let wake = () => {};
  const stop = (signal) => {
    stopping = true;
    console.log(JSON.stringify({ timestamp: new Date().toISOString(), level: "info", event: "notification.scheduler.stopping", signal }));
    wake();
  };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), level: "info", event: "notification.scheduler.started", intervalSeconds: config.intervalSeconds, target: new URL(config.url).origin }));

  while (!stopping) {
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, msUntilNextTick(Date.now(), config.intervalSeconds));
      wake = () => { clearTimeout(timer); resolve(); };
    });
    if (stopping) break;
    const result = await runTick(config);
    await writeHeartbeat(heartbeatContent(Date.now(), config.intervalSeconds, result.status));
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("notification-scheduler.mjs")) {
  (process.argv.includes("--healthcheck") ? healthcheck() : main()).catch((error) => {
    console.error(JSON.stringify({ timestamp: new Date().toISOString(), level: "error", event: "notification.scheduler.fatal", error: error instanceof Error ? error.message : String(error) }));
    process.exit(1);
  });
}
