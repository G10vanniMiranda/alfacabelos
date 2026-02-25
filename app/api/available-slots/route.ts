import { NextRequest, NextResponse } from "next/server";
import { getAvailableSlots } from "@/lib/booking-service";
import { DEFAULT_BARBER_ID } from "@/lib/constants/barber";

export async function GET(request: NextRequest) {
  const date = request.nextUrl.searchParams.get("date");
  const barberId = request.nextUrl.searchParams.get("barberId") ?? DEFAULT_BARBER_ID;
  const serviceId = request.nextUrl.searchParams.get("serviceId");

  if (!date || !serviceId) {
    return NextResponse.json({ message: "date e serviceId sao obrigatorios" }, { status: 400 });
  }

  try {
    const slots = await getAvailableSlots({ date, barberId, serviceId });
    return NextResponse.json(slots);
  } catch (error) {
    console.error("GET /api/available-slots failed", error);
    return NextResponse.json({ message: "Erro ao gerar horarios" }, { status: 400 });
  }
}
