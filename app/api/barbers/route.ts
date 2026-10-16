import { NextRequest, NextResponse } from "next/server";
import { listBarbers } from "@/lib/booking-service";
import { isDatabaseUnavailableError } from "@/lib/errors";
import { requestIdFromHeaders } from "@/lib/observability/context";
import { logger } from "@/lib/observability/logger";

export async function GET(request: NextRequest) {
  const requestId = requestIdFromHeaders(request.headers);
  const startedAt = Date.now();
  try {
    const barbers = await listBarbers();
    logger.info("barbers.list_completed", { requestId, count: barbers.length, durationMs: Date.now() - startedAt });
    return NextResponse.json(barbers);
  } catch (error) {
    logger.error("barbers.list_failed", { requestId, durationMs: Date.now() - startedAt, error });
    return NextResponse.json(
      { message: "Profissionais temporariamente indisponíveis." },
      { status: isDatabaseUnavailableError(error) ? 503 : 500 },
    );
  }
}

