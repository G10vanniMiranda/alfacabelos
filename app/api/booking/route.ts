import { NextRequest, NextResponse } from "next/server";
import { createBooking, getBookingById, isBookingConflictError } from "@/lib/booking-service";
import { notifyOwnerAboutClientBooking } from "@/lib/whatsapp";
import { getClientIp, isSameOriginRequest, registerRateLimitEvent } from "@/lib/security";
import { isDatabaseUnavailableError } from "@/lib/errors";
import { findClientBySessionToken } from "@/lib/auth/client-store";

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
    if (!isSameOriginRequest(request)) {
      return NextResponse.json({ message: "Origem invalida" }, { status: 403 });
    }
    const client = await findClientBySessionToken(request.cookies.get("barber_client")?.value ?? "");
    if (!client) {
      return NextResponse.json({ message: "Nao autorizado" }, { status: 401 });
    }
    const payload = await request.json();
    const rateLimit = await registerRateLimitEvent({
      scope: "public-booking-create",
      identifier: `${getClientIp(request)}:${client.id}`,
      windowSeconds: 15 * 60,
      maxAttempts: 10,
    });
    if (rateLimit.blocked) {
      return NextResponse.json({ message: "Muitas tentativas. Tente novamente em alguns minutos." }, { status: 429 });
    }

    const booking = await createBooking(
      { ...payload, customerName: client.name, customerPhone: client.phone },
      { clientId: client.id },
    );
    await notifyOwnerSafely(booking.id);

    return NextResponse.json(booking, { status: 201 });
  } catch (error) {
    console.error("POST /api/booking failed", error);
    if (isBookingConflictError(error)) {
      return NextResponse.json({ message: "Este horário não está mais disponível." }, { status: 409 });
    }
    if (isDatabaseUnavailableError(error)) {
      return NextResponse.json({ message: "Agenda temporariamente indisponível." }, { status: 503 });
    }
    return NextResponse.json({ message: "Não foi possível criar o agendamento." }, { status: 400 });
  }
}
