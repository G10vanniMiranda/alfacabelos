import { NextRequest, NextResponse } from "next/server";
import { createBooking, getBookingById } from "@/lib/booking-service";
import { notifyOwnerAboutClientBooking } from "@/lib/whatsapp";

async function notifyOwnerSafely(bookingId: string) {
  try {
    const bookingWithRelations = await getBookingById(bookingId);
    if (!bookingWithRelations) {
      console.warn(`[whatsapp] agendamento ${bookingId} nao encontrado para notificar dono`);
      return;
    }

    await notifyOwnerAboutClientBooking(bookingWithRelations);
  } catch (error) {
    console.error(`[whatsapp] falha ao notificar dono sobre agendamento ${bookingId}`, error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();
    const booking = await createBooking(payload);
    await notifyOwnerSafely(booking.id);

    return NextResponse.json(booking, { status: 201 });
  } catch (error) {
    console.error("POST /api/booking failed", error);
    return NextResponse.json({ message: "Erro ao criar agendamento" }, { status: 400 });
  }
}
