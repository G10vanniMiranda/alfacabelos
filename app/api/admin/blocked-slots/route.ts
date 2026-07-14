import { NextRequest, NextResponse } from "next/server";
import { createBlockedSlot, deleteBlockedSlot, listBlockedSlots } from "@/lib/booking-service";
import { getAdminSessionPrincipal } from "@/lib/auth/admin-session-store";
import { assertBlockedSlotScope, scopeBarber } from "@/lib/auth/staff-auth";
import { isSameOriginRequest } from "@/lib/security";

async function getPrincipal(request: NextRequest) {
  const token = request.cookies.get("barber_admin")?.value ?? "";
  return getAdminSessionPrincipal(token);
}

export async function GET(request: NextRequest) {
  const principal = await getPrincipal(request);
  if (!principal) {
    return NextResponse.json({ message: "Nao autorizado" }, { status: 401 });
  }

  const date = request.nextUrl.searchParams.get("date") ?? undefined;
  const blocked = (await listBlockedSlots(date)).filter((slot) =>
    principal.role === "ADMIN" || slot.barberId === principal.barberId,
  );
  return NextResponse.json(blocked);
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ message: "Origem invalida" }, { status: 403 });
  }

  const principal = await getPrincipal(request);
  if (!principal) {
    return NextResponse.json({ message: "Nao autorizado" }, { status: 401 });
  }

  try {
    const payload = await request.json();
    const created = await createBlockedSlot({ ...payload, barberId: scopeBarber(principal, payload.barberId) });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    console.error("POST /api/admin/blocked-slots failed", error);
    return NextResponse.json({ message: "Erro ao criar bloqueio" }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ message: "Origem invalida" }, { status: 403 });
  }

  const principal = await getPrincipal(request);
  if (!principal) {
    return NextResponse.json({ message: "Nao autorizado" }, { status: 401 });
  }

  const blockedSlotId = request.nextUrl.searchParams.get("blockedSlotId");
  if (!blockedSlotId) {
    return NextResponse.json({ message: "blockedSlotId e obrigatorio" }, { status: 400 });
  }

  try {
    await assertBlockedSlotScope(principal, blockedSlotId);
    await deleteBlockedSlot(blockedSlotId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("DELETE /api/admin/blocked-slots failed", error);
    return NextResponse.json({ message: "Erro ao remover bloqueio" }, { status: 400 });
  }
}
