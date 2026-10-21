import { NextRequest, NextResponse } from "next/server";
import { applicationVersion, checkDatabaseHealth } from "@/lib/observability/health";
import { requestIdFromHeaders } from "@/lib/observability/context";
import { logger } from "@/lib/observability/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const requestId = requestIdFromHeaders(request.headers);
  const database = await checkDatabaseHealth();
  const ok = database.status === "healthy";
  if (!ok) logger.error("health.database.unavailable", { requestId, errorCode: database.errorCode });
  return NextResponse.json({
    status: ok ? "ok" : "unhealthy",
    version: applicationVersion(),
    services: { database: { status: database.status, latencyMs: database.latencyMs } },
    requestId,
  }, { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } });
}
