import { NextRequest, NextResponse } from "next/server";
import { getAvailableSlots } from "@/lib/booking-service";

export async function GET(request: NextRequest) {
  const date = request.nextUrl.searchParams.get("date");
  const barberId = request.nextUrl.searchParams.get("barberId");
  const serviceId = request.nextUrl.searchParams.get("serviceId");

  if (!date || !barberId || !serviceId) {
    return NextResponse.json({ message: "date, barberId e serviceId são obrigatórios" }, { status: 400 });
  }

  try {
    const slots = await getAvailableSlots({ date, barberId, serviceId });
    return NextResponse.json(slots);
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Erro ao gerar horários" },
      { status: 400 },
    );
  }
}

