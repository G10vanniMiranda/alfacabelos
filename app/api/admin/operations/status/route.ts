import { NextRequest, NextResponse } from "next/server";
import { getAdminSessionPrincipal } from "@/lib/auth/admin-session-store";
import { evaluateOperationalAlerts } from "@/lib/observability/alerts";
import { requestIdFromHeaders } from "@/lib/observability/context";
import { checkDatabaseHealth, checkSchemaReadiness, getWhatsAppHealth, getWorkerHealth, applicationVersion } from "@/lib/observability/health";
import { getOperationalNotificationMetrics } from "@/lib/observability/metrics";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const requestId = requestIdFromHeaders(request.headers);
  const principal = await getAdminSessionPrincipal(request.cookies.get("barber_admin")?.value ?? "");
  if (!principal || principal.role !== "ADMIN") {
    return NextResponse.json({ message: "Não autorizado", requestId }, { status: 401, headers: { "cache-control": "no-store" } });
  }
  const database = await checkDatabaseHealth();
  if (database.status !== "healthy") {
    return NextResponse.json({
      application: { version: applicationVersion() }, database,
      notifications: null, worker: null, whatsapp: null,
      alerts: evaluateOperationalAlerts({ backlog: 0, oldestPendingAgeSeconds: null, newDead24h: 0, workerAgeSeconds: null, databaseLatencyMs: database.latencyMs }),
      requestId,
    }, { status: 503, headers: { "cache-control": "no-store" } });
  }
  const [schema, notifications, worker, whatsapp] = await Promise.all([
    checkSchemaReadiness(), getOperationalNotificationMetrics(), getWorkerHealth(), getWhatsAppHealth(),
  ]);
  const alerts = evaluateOperationalAlerts({
    backlog: notifications.backlog,
    oldestPendingAgeSeconds: notifications.oldestPendingAgeSeconds,
    newDead24h: notifications.dead24h,
    workerAgeSeconds: worker.ageSeconds,
    databaseLatencyMs: database.latencyMs,
  });
  return NextResponse.json({
    application: { version: applicationVersion() }, database, schema,
    notifications, worker, whatsapp, alerts, requestId,
  }, { headers: { "cache-control": "no-store" } });
}
