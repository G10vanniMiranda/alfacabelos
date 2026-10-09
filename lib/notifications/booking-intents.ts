import type { NotificationEvent, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { enqueueWhatsAppNotification, type NotificationIntentInput } from "@/lib/notifications/service";
import {
  buildBookingWhatsAppMessage,
  buildClientBookingConfirmation,
  buildOwnerBookingNotification,
  type BookingNotificationSnapshot,
} from "@/lib/whatsapp";
import { logger } from "@/lib/observability/logger";
import { reminderSchedule } from "@/lib/notifications/validity-policy";

type Audience = "OWNER" | "CLIENT";

function toSnapshot(
  booking: {
    id: string;
    customerName: string;
    customerPhone: string;
    observations: string | null;
    dateTimeStart: Date;
    status: string;
    service: { name: string; priceCents: number };
    barber: { name: string };
  },
  confirmationToken?: string,
): BookingNotificationSnapshot {
  return { ...booking, dateTimeStart: booking.dateTimeStart.toISOString(), confirmationToken };
}

export async function enqueueBookingNotification(
  tx: Prisma.TransactionClient,
  input: {
    bookingId: string;
    event: NotificationEvent;
    audience: Audience;
    confirmationToken?: string;
    requestId?: string;
  },
): Promise<void> {
  const booking = await tx.booking.findUnique({
    where: { id: input.bookingId },
    include: { service: { select: { name: true, priceCents: true } }, barber: { select: { name: true } } },
  });
  if (!booking) throw new Error(`Booking ${input.bookingId} not found while creating notification intent`);
  const intent = buildBookingNotificationIntent({
    snapshot: toSnapshot(booking, input.confirmationToken),
    seriesId: booking.seriesId ?? undefined,
    ...input,
  });
  if (intent) await enqueueWhatsAppNotification(tx, intent);
}

export function buildBookingNotificationIntent(input: {
  snapshot: BookingNotificationSnapshot;
  event: NotificationEvent;
  audience: Audience;
  seriesId?: string;
  updatedAt?: Date;
  requestId?: string;
}): NotificationIntentInput | null {
  const booking = input.snapshot;
  const ownerPhone = process.env.WHATSAPP_OWNER_PHONE?.trim();
  if (input.audience === "OWNER" && !ownerPhone) {
    logger.warn("notification.owner_recipient_missing", { requestId: input.requestId, bookingId: booking.id });
    return null;
  }

  const recipient = input.audience === "OWNER" ? ownerPhone! : booking.customerPhone;
  let message: string;
  if (input.event === "BOOKING_CREATED_BY_CLIENT") message = buildOwnerBookingNotification(booking, booking.observations ?? undefined);
  else if (input.event === "BOOKING_CREATED_BY_STAFF") message = buildClientBookingConfirmation(booking);
  else {
    const label = input.event === "BOOKING_CANCELLED"
      ? "Agendamento cancelado"
      : input.event === "BOOKING_REMINDER" ? "Lembrete do seu agendamento" : "Agendamento reagendado";
    message = `${label}\n\n${buildBookingWhatsAppMessage(booking)}`;
  }

  const suffix = input.event === "BOOKING_RESCHEDULED"
    ? `:${input.updatedAt?.toISOString() ?? booking.dateTimeStart}`
    : input.event === "BOOKING_REMINDER" ? `:${booking.dateTimeStart}` : "";
  return {
    event: input.event,
    bookingId: booking.id,
    seriesId: input.seriesId,
    idempotencyKey: `booking:${booking.id}:${input.audience.toLowerCase()}:${input.event.toLowerCase()}${suffix}`,
    to: recipient,
    message,
    context: `${input.event.toLowerCase()}:${booking.id}`,
    requestId: input.requestId,
  };
}

export async function enqueueDueBookingReminders(now = new Date(), requestId?: string): Promise<number> {
  // Reminders are time-bound by nature. While WhatsApp is disabled nothing can
  // deliver them, so creating rows would only accumulate intents that expire
  // before delivery is ever turned on.
  if (process.env.WHATSAPP_ENABLED !== "true") return 0;
  const { leadMinutes, windowMinutes } = reminderSchedule();
  const start = new Date(now.getTime() + (leadMinutes - windowMinutes) * 60_000);
  const end = new Date(now.getTime() + (leadMinutes + windowMinutes) * 60_000);
  return prisma.$transaction(async (tx) => {
    const bookings = await tx.booking.findMany({
      where: {
        status: { in: ["PENDENTE", "CONFIRMADO"] },
        dateTimeStart: { gte: start, lt: end },
      },
      orderBy: { dateTimeStart: "asc" },
      select: { id: true },
      take: 200,
    });
    for (const booking of bookings) {
      await enqueueBookingNotification(tx, { bookingId: booking.id, event: "BOOKING_REMINDER", audience: "CLIENT", requestId });
    }
    return bookings.length;
  });
}
