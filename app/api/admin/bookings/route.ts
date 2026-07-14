import { NextRequest, NextResponse } from "next/server";
import { listAdminBookings, updateBookingStatus } from "@/lib/booking-service";
import { getAdminSessionPrincipal } from "@/lib/auth/admin-session-store";
import { assertBookingScope, scopeBarber } from "@/lib/auth/staff-auth";
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
  const barberId = scopeBarber(principal, request.nextUrl.searchParams.get("barberId"));
  const status = (request.nextUrl.searchParams.get("status") ?? "TODOS") as
    | "PENDENTE"
    | "CONFIRMADO"
    | "CANCELADO" | "CONCLUIDO" | "AUSENTE"
    | "TODOS";

  const bookings = await listAdminBookings({ date, barberId, status });
  return NextResponse.json(bookings);
}

export async function PATCH(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ message: "Origem invalida" }, { status: 403 });
  }

  const principal = await getPrincipal(request);
  if (!principal) {
    return NextResponse.json({ message: "Nao autorizado" }, { status: 401 });
  }

  try {
    const payload = await request.json();
    await assertBookingScope(principal, String(payload.bookingId ?? ""));
    const updated = await updateBookingStatus(payload);
    return NextResponse.json(updated);
  } catch (error) {
    console.error("PATCH /api/admin/bookings failed", error);
    return NextResponse.json({ message: "Erro ao atualizar status" }, { status: 400 });
  }
}
