import { NextRequest, NextResponse } from "next/server";
import { listServices } from "@/lib/booking-service";
import { isDatabaseUnavailableError } from "@/lib/errors";
import { requestIdFromHeaders } from "@/lib/observability/context";
import { logger } from "@/lib/observability/logger";

export async function GET(request: NextRequest) {
  const requestId = requestIdFromHeaders(request.headers);
  const startedAt = Date.now();
  try {
    const services = await listServices();
    logger.info("services.list_completed", { requestId, count: services.length, durationMs: Date.now() - startedAt });
    return NextResponse.json(services);
  } catch (error) {
    logger.error("services.list_failed", { requestId, durationMs: Date.now() - startedAt, error });
    return NextResponse.json(
      { message: "Catálogo temporariamente indisponível." },
      { status: isDatabaseUnavailableError(error) ? 503 : 500 },
    );
  }
}

