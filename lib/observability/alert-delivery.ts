import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { OperationalAlert } from "@/lib/observability/alerts";

type AlertEnvironment = Record<string, string | undefined>;
type AlertDeliveryStatus = "sent" | "suppressed" | "disabled" | "failed";

export type AlertDeliveryResult = {
  code: string;
  status: AlertDeliveryStatus;
  httpStatus?: number;
  errorCode?: "invalid_receiver" | "claim_failed" | "delivery_failed";
  deduplication?: "degraded";
};

type ClaimInput = {
  code: string;
  severity: OperationalAlert["severity"];
  now: Date;
  cooldownSeconds: number;
};

type SendInput = {
  url: string;
  token?: string;
  body: Record<string, unknown>;
  timeoutMs: number;
};

export type AlertDeliveryDependencies = {
  claim: (input: ClaimInput) => Promise<boolean>;
  send: (input: SendInput) => Promise<{ ok: boolean; status: number }>;
  record?: (input: { code: string; status: "success" | "failure"; now: Date; httpStatus?: number }) => Promise<void>;
};

type DispatchContext = {
  requestId: string;
  now?: Date;
  env?: AlertEnvironment;
  allowUndeduplicatedOnClaimFailure?: boolean;
};

function boundedInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host === "::1" || host === "0:0:0:0:0:0:0:1") return true;
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)?.slice(1).map(Number);
  if (ipv4 && ipv4.every((part) => part >= 0 && part <= 255)) {
    const [first, second] = ipv4;
    return first === 0 || first === 10 || first === 127 || first === 169 && second === 254
      || first === 172 && second >= 16 && second <= 31 || first === 192 && second === 168
      || first === 100 && second >= 64 && second <= 127;
  }
  return /^(?:fc|fd|fe8|fe9|fea|feb)/i.test(host);
}

export function isSafeAlertWebhookUrl(value: string | undefined): boolean {
  try {
    const url = new URL(value ?? "");
    return url.protocol === "https:" && !url.username && !url.password && !isPrivateHostname(url.hostname);
  } catch {
    return false;
  }
}

function alertWorker(code: string): string {
  return `operational-alert:${code}`;
}

async function claimAlert(input: ClaimInput): Promise<boolean> {
  const worker = alertWorker(input.code);
  const cutoff = new Date(input.now.getTime() - input.cooldownSeconds * 1000);
  const metadata = JSON.stringify({ code: input.code, severity: input.severity });
  const rows = await prisma.$queryRaw<Array<{ claimed: boolean }>>(Prisma.sql`
    INSERT INTO "OperationalHeartbeat"
      ("worker", "status", "lastRunAt", "processedCount", "metadata", "updatedAt")
    VALUES
      (${worker}, 'running', ${input.now}, 0, ${metadata}::jsonb, ${input.now})
    ON CONFLICT ("worker") DO UPDATE SET
      "status" = 'running',
      "lastRunAt" = EXCLUDED."lastRunAt",
      "metadata" = EXCLUDED."metadata",
      "updatedAt" = EXCLUDED."updatedAt"
    WHERE "OperationalHeartbeat"."lastRunAt" <= ${cutoff}
    RETURNING TRUE AS "claimed"
  `);
  return rows[0]?.claimed === true;
}

async function sendWebhook(input: SendInput): Promise<{ ok: boolean; status: number }> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "user-agent": "alfa-cabelos-operational-alerts/1.0",
  };
  if (input.token) headers.authorization = `Bearer ${input.token}`;
  const response = await fetch(input.url, {
    method: "POST",
    headers,
    body: JSON.stringify(input.body),
    signal: AbortSignal.timeout(input.timeoutMs),
  });
  return { ok: response.ok, status: response.status };
}

async function recordAlert(input: { code: string; status: "success" | "failure"; now: Date; httpStatus?: number }) {
  await prisma.operationalHeartbeat.update({
    where: { worker: alertWorker(input.code) },
    data: {
      status: input.status,
      ...(input.status === "success" ? { lastSuccessAt: input.now } : { lastFailureAt: input.now }),
      processedCount: input.status === "success" ? 1 : 0,
      lastErrorCode: input.status === "failure" ? `http_${input.httpStatus ?? "network"}` : null,
      metadata: { code: input.code, httpStatus: input.httpStatus ?? null },
    },
  });
}

const defaultDependencies: AlertDeliveryDependencies = {
  claim: claimAlert,
  send: sendWebhook,
  record: recordAlert,
};

export async function dispatchOperationalAlerts(
  alerts: OperationalAlert[],
  context: DispatchContext,
  dependencies: AlertDeliveryDependencies = defaultDependencies,
): Promise<AlertDeliveryResult[]> {
  const env = context.env ?? process.env;
  const receiver = env.ALERT_WEBHOOK_URL?.trim();
  if (!receiver) return alerts.map((alert) => ({ code: alert.code, status: "disabled" }));

  let receiverUrl: URL;
  try {
    receiverUrl = new URL(receiver);
    if (!isSafeAlertWebhookUrl(receiver)) throw new Error("unsafe_receiver");
  } catch {
    return alerts.map((alert) => ({ code: alert.code, status: "failed", errorCode: "invalid_receiver" }));
  }

  const now = context.now ?? new Date();
  const cooldownSeconds = boundedInteger(env.ALERT_COOLDOWN_SECONDS, 15 * 60, 60, 24 * 60 * 60);
  const timeoutMs = boundedInteger(env.ALERT_WEBHOOK_TIMEOUT_MS, 5_000, 1_000, 15_000);
  const results: AlertDeliveryResult[] = [];

  for (const alert of alerts) {
    let claimed: boolean;
    let deduplicationDegraded = false;
    try {
      claimed = await dependencies.claim({ code: alert.code, severity: alert.severity, now, cooldownSeconds });
    } catch {
      if (!context.allowUndeduplicatedOnClaimFailure) {
        results.push({ code: alert.code, status: "failed", errorCode: "claim_failed" });
        continue;
      }
      claimed = true;
      deduplicationDegraded = true;
    }
    if (!claimed) {
      results.push({ code: alert.code, status: "suppressed" });
      continue;
    }

    const body = {
      source: "alfa-cabelos",
      environment: env.APP_ENV || env.VERCEL_ENV || env.NODE_ENV || "unknown",
      code: alert.code,
      severity: alert.severity,
      value: alert.value,
      threshold: alert.threshold,
      detectedAt: now.toISOString(),
      requestId: context.requestId,
      ...(deduplicationDegraded ? { deduplication: "degraded" } : {}),
    };
    try {
      const response = await dependencies.send({
        url: receiverUrl.toString(),
        token: env.ALERT_WEBHOOK_TOKEN?.trim() || undefined,
        body,
        timeoutMs,
      });
      const status = response.ok ? "sent" : "failed";
      try {
        await dependencies.record?.({ code: alert.code, status: response.ok ? "success" : "failure", now, httpStatus: response.status });
      } catch {
        // The durable claim still enforces cooldown; telemetry persistence is best effort.
      }
      results.push({
        code: alert.code,
        status,
        httpStatus: response.status,
        ...(deduplicationDegraded ? { deduplication: "degraded" as const } : {}),
      });
    } catch {
      try {
        await dependencies.record?.({ code: alert.code, status: "failure", now });
      } catch {
        // Delivery already failed; recording failure must not fail the notification worker.
      }
      results.push({ code: alert.code, status: "failed", errorCode: "delivery_failed" });
    }
  }
  return results;
}
