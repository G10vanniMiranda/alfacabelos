import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentClient } from "@/lib/actions/client-auth-actions";
import { listClientBookingHistory } from "@/lib/booking-query-service";
import { CLIENT_HISTORY_MAX_LIMIT, CLIENT_HISTORY_PAGE_SIZE } from "@/lib/query-contracts";
import { requestIdFromHeaders } from "@/lib/observability/context";
import { logger } from "@/lib/observability/logger";

const querySchema = z.object({
  cursor: z.string().trim().min(1).max(500).optional(),
  limit: z.coerce.number().int().min(1).max(CLIENT_HISTORY_MAX_LIMIT).default(CLIENT_HISTORY_PAGE_SIZE),
});

export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  const requestId = requestIdFromHeaders(request.headers);
  const client = await getCurrentClient();
  if (!client) return NextResponse.json({ message: "Não autorizado" }, { status: 401 });

  try {
    const query = querySchema.parse(Object.fromEntries(request.nextUrl.searchParams.entries()));
    const page = await listClientBookingHistory(client.id, query);
    logger.info("client.bookings.list_completed", { requestId, clientId: client.id, durationMs: Date.now() - startedAt });
    return NextResponse.json(page, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    logger.warn("client.bookings.list_rejected", { requestId, clientId: client.id, durationMs: Date.now() - startedAt, error });
    return NextResponse.json({ message: "Parâmetros de consulta inválidos" }, { status: 400 });
  }
}
