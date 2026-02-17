import { NextRequest, NextResponse } from "next/server";
import { listAdminBookings, updateBookingStatus } from "@/lib/booking-service";

function isAuthorized(request: NextRequest): boolean {
  return request.cookies.get("barber_admin")?.value === "ok";
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ message: "Nao autorizado" }, { status: 401 });
  }

  const date = request.nextUrl.searchParams.get("date") ?? undefined;
  const barberId = request.nextUrl.searchParams.get("barberId") ?? undefined;
  const status = (request.nextUrl.searchParams.get("status") ?? "TODOS") as
    | "PENDENTE"
    | "CONFIRMADO"
    | "CANCELADO"
    | "TODOS";

  const bookings = await listAdminBookings({ date, barberId, status });
  return NextResponse.json(bookings);
}

export async function PATCH(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ message: "Nao autorizado" }, { status: 401 });
  }

  try {
    const payload = await request.json();
    const updated = await updateBookingStatus(payload);
    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Erro ao atualizar status" },
      { status: 400 },
    );
  }
}

