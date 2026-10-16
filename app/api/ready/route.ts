import { NextRequest, NextResponse } from "next/server";
import { checkCriticalConfiguration, checkDatabaseHealth, checkSchemaReadiness } from "@/lib/observability/health";
import { requestIdFromHeaders } from "@/lib/observability/context";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const requestId = requestIdFromHeaders(request.headers);
  const database = await checkDatabaseHealth();
  const [schema, configuration] = database.status === "healthy"
    ? await Promise.all([checkSchemaReadiness(), Promise.resolve(checkCriticalConfiguration())])
    : [{ status: "unhealthy" as const, compatible: false }, checkCriticalConfiguration()];
  const ready = database.status === "healthy" && schema.status === "healthy" && configuration.status === "healthy";
  return NextResponse.json({
    status: ready ? "ready" : "not_ready",
    checks: {
      database: database.status,
      schema: schema.status,
      configuration: configuration.status,
    },
    requestId,
  }, { status: ready ? 200 : 503, headers: { "cache-control": "no-store" } });
}
