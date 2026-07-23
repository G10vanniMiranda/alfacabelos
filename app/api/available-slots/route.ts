import { NextRequest, NextResponse } from "next/server";
import { getAvailableSlots } from "@/lib/booking-service";
import { DEFAULT_BARBER_ID } from "@/lib/constants/barber";
import { isDatabaseUnavailableError } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const date = request.nextUrl.searchParams.get("date");
  const barberId = request.nextUrl.searchParams.get("barberId") ?? DEFAULT_BARBER_ID;
  const serviceId = request.nextUrl.searchParams.get("serviceId");

  if (!date || !serviceId) {
    return NextResponse.json({ message: "date e serviceId são obrigatórios" }, { status: 400 });
  }

  try {
    const slots = await getAvailableSlots({ date, barberId, serviceId });
    return NextResponse.json(slots, {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (error) {
    console.error("GET /api/available-slots failed", error);
    if (isDatabaseUnavailableError(error)) {
      return NextResponse.json({ message: "Agenda temporariamente indisponível." }, { status: 503 });
    }
    return NextResponse.json({ message: "Não foi possível consultar os horários." }, { status: 400 });
  }
}
