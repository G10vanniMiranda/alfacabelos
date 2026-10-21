import { NextRequest, NextResponse } from "next/server";
import { createBlockedSlot, deleteBlockedSlot, listBlockedSlots } from "@/lib/booking-service";
import { getAdminSessionPrincipal } from "@/lib/auth/admin-session-store";
import { assertBlockedSlotScope, scopeBarber } from "@/lib/auth/staff-auth";
import { isSameOriginRequest } from "@/lib/security";
import { BUSINESS_CONFIG } from "@/lib/config";
import { getTodayInTimeZone } from "@/lib/utils";
import { requestIdFromHeaders } from "@/lib/observability/context";
import { logger } from "@/lib/observability/logger";
import { recordAuditEvent } from "@/lib/observability/audit";
import { prisma } from "@/lib/prisma";

async function getPrincipal(request: NextRequest) {
  const token = request.cookies.get("barber_admin")?.value ?? "";
  return getAdminSessionPrincipal(token);
}

export async function GET(request: NextRequest) {
  const principal = await getPrincipal(request);
  if (!principal) {
    return NextResponse.json({ message: "Não autorizado" }, { status: 401 });
  }

  const date = request.nextUrl.searchParams.get("date") ?? getTodayInTimeZone(BUSINESS_CONFIG.timezone);
  const blocked = (await listBlockedSlots(date)).filter((slot) =>
    principal.role === "ADMIN" || slot.barberId === principal.barberId,
  );
  return NextResponse.json(blocked);
}

export async function POST(request: NextRequest) {
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
    const created = await createBlockedSlot({ ...payload, barberId: scopeBarber(principal, payload.barberId) });
    await recordAuditEvent(prisma, {
      actorType: principal.role,
      actorId: principal.accessId,
      action: "blocked_slot.created",
      resourceType: "BlockedSlot",
      resourceId: created.id,
      requestId,
      metadata: { barberId: created.barberId },
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    logger.error("admin.blocked_slot.create_failed", { requestId, actorId: principal.accessId, error });
    return NextResponse.json({ message: "Erro ao criar bloqueio" }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  const requestId = requestIdFromHeaders(request.headers);
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ message: "Origem inválida" }, { status: 403 });
  }

  const principal = await getPrincipal(request);
  if (!principal) {
    return NextResponse.json({ message: "Não autorizado" }, { status: 401 });
  }

  const blockedSlotId = request.nextUrl.searchParams.get("blockedSlotId");
  if (!blockedSlotId) {
    return NextResponse.json({ message: "blockedSlotId é obrigatório" }, { status: 400 });
  }

  try {
    await assertBlockedSlotScope(principal, blockedSlotId);
    await deleteBlockedSlot(blockedSlotId);
    await recordAuditEvent(prisma, {
      actorType: principal.role,
      actorId: principal.accessId,
      action: "blocked_slot.deleted",
      resourceType: "BlockedSlot",
      resourceId: blockedSlotId,
      requestId,
    });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    logger.error("admin.blocked_slot.delete_failed", { requestId, actorId: principal.accessId, error });
    return NextResponse.json({ message: "Erro ao remover bloqueio" }, { status: 400 });
  }
}
