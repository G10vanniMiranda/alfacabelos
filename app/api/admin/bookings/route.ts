import { NextRequest, NextResponse } from "next/server";
import { updateBookingStatus } from "@/lib/booking-service";
import { listBookingRange } from "@/lib/booking-query-service";
import { parseAdminBookingsQuery } from "@/lib/query-contracts";
import { getAdminSessionPrincipal } from "@/lib/auth/admin-session-store";
import { assertBookingScope, scopeBarber } from "@/lib/auth/staff-auth";
import { isSameOriginRequest } from "@/lib/security";
import { requestIdFromHeaders } from "@/lib/observability/context";
import { logger } from "@/lib/observability/logger";
import { recordAuditEvent } from "@/lib/observability/audit";
import { prisma } from "@/lib/prisma";

async function getPrincipal(request: NextRequest) {
  const token = request.cookies.get("barber_admin")?.value ?? "";
  return getAdminSessionPrincipal(token);
}

export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  const requestId = requestIdFromHeaders(request.headers);
  const principal = await getPrincipal(request);
  if (!principal) {
    return NextResponse.json({ message: "Não autorizado" }, { status: 401 });
  }

  try {
    const query = parseAdminBookingsQuery(request.nextUrl.searchParams);
    const barberId = scopeBarber(principal, query.barberId);
    const response = await listBookingRange({ ...query, barberId });
    logger.info("admin.bookings.list_completed", { requestId, actorId: principal.accessId, durationMs: Date.now() - startedAt });
    return NextResponse.json(response, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    logger.warn("admin.bookings.list_rejected", { requestId, actorId: principal.accessId, durationMs: Date.now() - startedAt, error });
    return NextResponse.json({ message: "Parâmetros de consulta inválidos" }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest) {
  const requestId = requestIdFromHeaders(request.headers);
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ message: "Origem inválida" }, { status: 403 });
  }

  const principal = await getPrincipal(request);
  if (!principal) {
    return NextResponse.json({ message: "Não autorizado" }, { status: 401 });
  }

  try {
    const payload = await request.json();
    await assertBookingScope(principal, String(payload.bookingId ?? ""));
    const updated = await updateBookingStatus(payload);
    await recordAuditEvent(prisma, {
      actorType: principal.role,
      actorId: principal.accessId,
      action: "booking.status_changed",
      resourceType: "Booking",
      resourceId: updated.id,
      requestId,
      metadata: { status: updated.status },
    });
    return NextResponse.json(updated);
  } catch (error) {
    logger.error("admin.booking.status_change_failed", { requestId, actorId: principal.accessId, error });
    return NextResponse.json({ message: "Erro ao atualizar status" }, { status: 400 });
  }
}
