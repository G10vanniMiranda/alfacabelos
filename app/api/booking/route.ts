import { NextRequest, NextResponse } from "next/server";
import { createBooking } from "@/lib/booking-service";

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();
    const booking = await createBooking(payload);
    return NextResponse.json(booking, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Erro ao criar agendamento" },
      { status: 400 },
    );
  }
}

