import { NextRequest, NextResponse } from "next/server";
import { processNotificationBatch } from "@/lib/notifications/service";
import { getClientIp, registerRateLimitEvent } from "@/lib/security";
import { enqueueDueBookingReminders } from "@/lib/notifications/booking-intents";
import { isValidCronAuthorization } from "@/lib/notifications/cron-auth";
import { requestIdFromHeaders } from "@/lib/observability/context";
import { logger } from "@/lib/observability/logger";
import { getOperationalNotificationMetrics } from "@/lib/observability/metrics";
import { evaluateOperationalAlerts } from "@/lib/observability/alerts";
import { dispatchOperationalAlerts } from "@/lib/observability/alert-delivery";
import { checkDatabaseHealth } from "@/lib/observability/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const requestId = requestIdFromHeaders(request.headers);
  if (!isValidCronAuthorization(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ ok: false, message: "Unauthorized" }, {
      status: 401,
      headers: { "cache-control": "no-store" },
    });
  }

  const startedAt = Date.now();
  try {
    const rateLimit = await registerRateLimitEvent({
      scope: "notification-worker",
      identifier: getClientIp(request),
      windowSeconds: 60,
      maxAttempts: 20,
    });
    if (rateLimit.blocked) {
      return NextResponse.json({ ok: false, message: "Rate limited" }, {
        status: 429,
        headers: { "cache-control": "no-store", "retry-after": String(rateLimit.retryAfterSeconds) },
      });
    }

    const before = await getOperationalNotificationMetrics();
    logger.info("notification.worker.started", {
      requestId,
      backlogBefore: before.backlog,
      eligibleNow: before.eligibleNow,
      batchSize: process.env.NOTIFICATION_BATCH_SIZE ?? 25,
    });
    const remindersEnqueued = await enqueueDueBookingReminders(new Date(), requestId);
    const summary = await processNotificationBatch();
    const after = await getOperationalNotificationMetrics();
    const alerts = evaluateOperationalAlerts({
      backlog: after.backlog, oldestPendingAgeSeconds: after.oldestPendingAgeSeconds,
      newDead24h: after.dead24h, workerAgeSeconds: 0, databaseLatencyMs: 0,
    });
    logger.info("notification.worker.completed", {
      requestId, workerId: summary.workerId, batchSize: process.env.NOTIFICATION_BATCH_SIZE ?? 25,
      eligibleNowBefore: before.eligibleNow, eligibleNowAfter: after.eligibleNow,
      claimed: summary.claimed, sent: summary.sent, retry: summary.retry,
      dead: summary.dead, remindersEnqueued, backlogBefore: before.backlog,
      backlogAfter: after.backlog, oldestPendingAgeSeconds: after.oldestPendingAgeSeconds,
      oldestEligibleAgeSeconds: after.oldestEligibleAgeSeconds,
      durationMs: Date.now() - startedAt, alertCodes: alerts.map((alert) => alert.code),
    });
    for (const alert of alerts) logger.warn("operational.alert.triggered", { requestId, ...alert });
    const alertDeliveries = await dispatchOperationalAlerts(alerts, { requestId });
    for (const delivery of alertDeliveries) {
      const level = delivery.status === "failed" ? "error" : "info";
      logger[level]("operational.alert.delivery", { requestId, ...delivery });
    }
    return NextResponse.json({ ok: true, ...summary, remindersEnqueued, alertDeliveries }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const database = await checkDatabaseHealth();
    const failureAlert = database.status === "unhealthy"
      ? { code: "database.unavailable", severity: "critical" as const, value: database.latencyMs, threshold: 0 }
      : { code: "worker.execution_failed", severity: "critical" as const, value: null, threshold: 0 };
    const alertDeliveries = await dispatchOperationalAlerts([failureAlert], {
      requestId,
      allowUndeduplicatedOnClaimFailure: database.status === "unhealthy",
    });
    logger.error("notification.worker.endpoint_failed", {
      requestId,
      durationMs: Date.now() - startedAt,
      error,
      databaseStatus: database.status,
      alertDeliveries,
    });
    return NextResponse.json({ ok: false, message: "Worker failed", requestId, alertDeliveries }, { status: 500, headers: { "cache-control": "no-store" } });
  }
}
