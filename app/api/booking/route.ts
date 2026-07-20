import { NextRequest, NextResponse } from "next/server";
import { getBookingById, isBookingConflictError } from "@/lib/booking-service";
import { createBookingSeriesAtomic } from "@/lib/booking-series-service";
import { createAdminBookingSchema } from "@/lib/validators/schemas";
import { notifyClientAboutAdminBooking, notifyOwnerAboutClientBooking } from "@/lib/whatsapp";
import { getClientIp, isSameOriginRequest, registerRateLimitEvent } from "@/lib/security";
import { isDatabaseUnavailableError } from "@/lib/errors";
import { findClientBySessionToken } from "@/lib/auth/client-store";
import { getAdminSessionPrincipal } from "@/lib/auth/admin-session-store";
import { scopeBarber } from "@/lib/auth/staff-auth";
import { repository } from "@/lib/repositories";

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
    const [client, staff] = await Promise.all([
      findClientBySessionToken(request.cookies.get("barber_client")?.value ?? ""),
      getAdminSessionPrincipal(request.cookies.get("barber_admin")?.value ?? ""),
    ]);
    if (!client && !staff) {
      return NextResponse.json({ message: "Nao autorizado" }, { status: 401 });
    }
    const payload = await request.json();
    const rateLimit = await registerRateLimitEvent({
      scope: "public-booking-create",
      identifier: `${getClientIp(request)}:${client?.id ?? staff?.accessId}`,
      windowSeconds: 15 * 60,
      maxAttempts: 10,
    });
    if (rateLimit.blocked) {
      return NextResponse.json({ message: "Muitas tentativas. Tente novamente em alguns minutos." }, { status: 429 });
    }

    const parsed = createAdminBookingSchema.safeParse({
      ...payload,
      barberId: staff ? scopeBarber(staff, payload.barberId) : payload.barberId,
      customerName: client?.name ?? payload.customerName,
      customerPhone: client?.phone ?? payload.customerPhone,
      recurrence: payload.recurrence ?? "NONE",
      idempotencyKey: payload.idempotencyKey ?? request.headers.get("idempotency-key") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json({ message: parsed.error.issues[0]?.message ?? "Dados invalidos" }, { status: 400 });
    }
    const linkedClient = client ?? await repository.upsertPendingClient({ name: parsed.data.customerName, phone: parsed.data.customerPhone });
    const creation = await createBookingSeriesAtomic({
      serviceId: parsed.data.serviceId,
      barberId: parsed.data.barberId,
      clientId: linkedClient.id,
      customerName: parsed.data.customerName,
      customerPhone: parsed.data.customerPhone,
      observations: parsed.data.observations,
      start: parsed.data.start,
      recurrence: parsed.data.recurrence,
      repeatUntil: parsed.data.repeatUntil,
      interval: parsed.data.interval,
      weekdays: parsed.data.weekdays,
      idempotencyKey: parsed.data.idempotencyKey,
      createdBy: client ? "CLIENT" : "BARBER",
      requireConfirmation: Boolean(staff),
    });
    if (client) {
      await Promise.all(creation.bookingIds.map(notifyOwnerSafely));
    } else {
      await Promise.all(creation.bookingIds.map(async (bookingId) => {
        const booking = await getBookingById(bookingId);
        if (booking) await notifyClientAboutAdminBooking({ ...booking, confirmationToken: creation.rawConfirmationTokens.get(bookingId) });
      }));
    }
    const bookings = (await Promise.all(creation.bookingIds.map(getBookingById))).filter(Boolean);
    const booking = bookings[0];
    return NextResponse.json(
      parsed.data.recurrence === "NONE" ? booking : { seriesId: creation.seriesId, occurrenceCount: bookings.length, bookings },
      { status: creation.duplicate ? 200 : 201 },
    );
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
