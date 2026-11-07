import { createHash } from "node:crypto";
import type { NotificationEvent, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { enqueueWhatsAppNotifications, type NotificationIntentInput } from "@/lib/notifications/service";
import { normalizeWhatsAppPhone } from "@/lib/notifications/phone";
import { whatsAppProviderName } from "@/lib/notifications/whatsapp-provider";
import {
  buildBookingCancellationMessage,
  buildBookingRescheduleMessage,
  buildBookingWhatsAppMessage,
  buildClientBookingConfirmation,
  buildClientBookingReceipt,
  buildOwnerBookingNotification,
  buildSeriesNotificationMessage,
  type BookingChangeActor,
  type BookingNotificationSnapshot,
} from "@/lib/whatsapp";
import { logger } from "@/lib/observability/logger";
import { reminderSchedule } from "@/lib/notifications/validity-policy";

export type Audience = "OWNER" | "CLIENT";
export type { BookingChangeActor };

type BookingEvent = Extract<NotificationEvent,
  "BOOKING_CREATED_BY_CLIENT" | "BOOKING_CREATED_BY_STAFF" | "BOOKING_CANCELLED" | "BOOKING_RESCHEDULED" | "BOOKING_REMINDER">;

/** Who is told about each booking event. Reminders stay client-only. */
export const BOOKING_EVENT_AUDIENCES: Record<BookingEvent, Audience[]> = {
  BOOKING_CREATED_BY_CLIENT: ["OWNER", "CLIENT"],
  BOOKING_CREATED_BY_STAFF: ["OWNER", "CLIENT"],
  BOOKING_CANCELLED: ["OWNER", "CLIENT"],
  BOOKING_RESCHEDULED: ["OWNER", "CLIENT"],
  BOOKING_REMINDER: ["CLIENT"],
};

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

type IntentContext = { requestId?: string; bookingId: string; event: BookingEvent };

/**
 * Normalized E.164 recipient per audience. A missing or invalid number skips only that
 * audience. When the owner number is the client's own number, one message is enough: the
 * client variant is kept because it may carry an action (confirmation link) and already
 * holds the date, time and service.
 */
function resolveRecipients(snapshot: BookingNotificationSnapshot, audiences: Audience[], context: IntentContext): Array<[Audience, string]> {
  const fields = { requestId: context.requestId, bookingId: context.bookingId, eventType: context.event };
  const recipients = new Map<Audience, string>();
  if (audiences.includes("CLIENT")) {
    const client = normalizeWhatsAppPhone(snapshot.customerPhone);
    if (client) recipients.set("CLIENT", client);
    else logger.warn("notification.client_recipient_invalid", fields);
  }
  if (audiences.includes("OWNER")) {
    const configured = process.env.WHATSAPP_OWNER_PHONE?.trim();
    const owner = configured ? normalizeWhatsAppPhone(configured) : null;
    if (!configured) logger.warn("notification.owner_recipient_missing", fields);
    else if (!owner) logger.warn("notification.owner_recipient_invalid", fields);
    else if (owner === recipients.get("CLIENT")) logger.info("notification.owner_recipient_same_as_client", fields);
    else recipients.set("OWNER", owner);
  }
  return audiences.flatMap((audience) => (recipients.has(audience) ? [[audience, recipients.get(audience)!] as [Audience, string]] : []));
}

function messageFor(event: BookingEvent, audience: Audience, booking: BookingNotificationSnapshot, actor: BookingChangeActor): string {
  switch (event) {
    case "BOOKING_CREATED_BY_CLIENT":
      return audience === "OWNER" ? buildOwnerBookingNotification(booking, booking.observations ?? undefined) : buildClientBookingReceipt(booking);
    case "BOOKING_CREATED_BY_STAFF":
      // The owner's copy must never carry the client's confirmation link.
      return audience === "OWNER"
        ? buildOwnerBookingNotification({ ...booking, confirmationToken: undefined }, booking.observations ?? undefined, "📅 Agendamento criado pela equipe - Alfa Cabelos")
        : buildClientBookingConfirmation(booking);
    case "BOOKING_CANCELLED":
      return buildBookingCancellationMessage(booking, audience, actor);
    case "BOOKING_RESCHEDULED":
      return buildBookingRescheduleMessage(booking, audience, actor);
    default:
      return `Lembrete do seu agendamento\n\n${buildBookingWhatsAppMessage(booking)}`;
  }
}

/**
 * Meta only accepts business-initiated free text inside the 24h service window.
 * shortcut: booking notices are plain text, so they are not enqueued for Meta; add approved
 * UTILITY templates per event/audience before using Meta for them.
 */
export function bookingNotificationsSupported(env: Partial<NodeJS.ProcessEnv> = process.env): boolean {
  return whatsAppProviderName(env) !== "meta";
}

export function buildBookingNotificationIntents(input: {
  snapshot: BookingNotificationSnapshot;
  event: BookingEvent;
  actor?: BookingChangeActor;
  seriesId?: string;
  updatedAt?: Date;
  requestId?: string;
}): NotificationIntentInput[] {
  const booking = input.snapshot;
  const context = { requestId: input.requestId, bookingId: booking.id, event: input.event };
  if (!bookingNotificationsSupported()) {
    logger.warn("notification.booking_channel_unsupported", { ...context, eventType: input.event });
    return [];
  }

  const suffix = input.event === "BOOKING_RESCHEDULED"
    ? `:${input.updatedAt?.toISOString() ?? booking.dateTimeStart}`
    : input.event === "BOOKING_REMINDER" ? `:${booking.dateTimeStart}` : "";
  return resolveRecipients(booking, BOOKING_EVENT_AUDIENCES[input.event], context).map(([audience, recipient]) => ({
    event: input.event,
    bookingId: booking.id,
    seriesId: input.seriesId,
    // One row per booking, audience and event: replays and concurrent writers collapse onto it.
    idempotencyKey: `booking:${booking.id}:${audience.toLowerCase()}:${input.event.toLowerCase()}${suffix}`,
    to: recipient,
    message: messageFor(input.event, audience, booking, input.actor ?? "STAFF"),
    context: `${input.event.toLowerCase()}:${booking.id}`,
    requestId: input.requestId,
  }));
}

type SeriesEvent = Exclude<BookingEvent, "BOOKING_REMINDER">;

/**
 * One notice per audience for a group of occurrences instead of one per occurrence.
 * Keys are deterministic, so replays and concurrent writers collapse onto the same row:
 *   creation:   series:<seriesId>:<audience>:<event>
 *   cancel:     series:<seriesId>:<audience>:<group>:booking_cancelled
 *   reschedule: series:<seriesId>:<audience>:<group>:booking_rescheduled:<anchor start ISO>
 * The row's bookingId is an anchor occurrence so the existing validity policy applies:
 * the first one for creation/reschedule, the last one for a cancellation.
 */
export function buildSeriesNotificationIntents(input: {
  seriesId: string;
  occurrences: BookingNotificationSnapshot[];
  event: SeriesEvent;
  actor?: BookingChangeActor;
  requestId?: string;
}): NotificationIntentInput[] {
  const occurrences = [...input.occurrences].sort((a, b) => a.dateTimeStart.localeCompare(b.dateTimeStart));
  const first = occurrences[0];
  if (!first) return [];
  const context = { requestId: input.requestId, bookingId: first.id, event: input.event };
  if (!bookingNotificationsSupported()) {
    logger.warn("notification.booking_channel_unsupported", { ...context, eventType: input.event, seriesId: input.seriesId });
    return [];
  }
  const anchor = input.event === "BOOKING_CANCELLED" ? occurrences[occurrences.length - 1]! : first;
  const group = createHash("sha256").update(occurrences.map((item) => item.id).sort().join(",")).digest("hex").slice(0, 12);
  const event = input.event.toLowerCase();
  const keyTail = input.event === "BOOKING_CANCELLED" ? `${group}:${event}`
    : input.event === "BOOKING_RESCHEDULED" ? `${group}:${event}:${anchor.dateTimeStart}`
    : event;
  return resolveRecipients(first, BOOKING_EVENT_AUDIENCES[input.event], context).map(([audience, recipient]) => ({
    event: input.event,
    bookingId: anchor.id,
    seriesId: input.seriesId,
    idempotencyKey: `series:${input.seriesId}:${audience.toLowerCase()}:${keyTail}`,
    to: recipient,
    message: buildSeriesNotificationMessage({
      event: input.event, audience, actor: input.actor ?? "STAFF", occurrences, seriesId: input.seriesId,
    }),
    context: `${event}:series:${input.seriesId}`,
    requestId: input.requestId,
  }));
}

const BOOKING_SNAPSHOT_INCLUDE = { service: { select: { name: true, priceCents: true } }, barber: { select: { name: true } } } as const;

/**
 * Notifies a group of occurrences: a single one keeps the per-booking notice, several get one
 * consolidated notice per audience. Occurrences already in the past are left out of the message.
 */
export async function enqueueOccurrenceGroupNotification(
  tx: Prisma.TransactionClient,
  input: {
    seriesId: string | null | undefined;
    bookingIds: string[];
    event: SeriesEvent;
    actor?: BookingChangeActor;
    /** Raw confirmation token of the earliest occurrence (staff-created series). */
    firstConfirmationToken?: string;
    requestId?: string;
    now?: Date;
  },
): Promise<number> {
  if (!input.bookingIds.length) return 0;
  const now = input.now ?? new Date();
  const bookings = await tx.booking.findMany({
    where: { id: { in: input.bookingIds }, dateTimeStart: { gt: now } },
    include: BOOKING_SNAPSHOT_INCLUDE,
    orderBy: { dateTimeStart: "asc" },
  });
  if (!bookings.length) return 0;
  if (bookings.length === 1 || !input.seriesId) {
    let count = 0;
    for (const booking of bookings) {
      count += await enqueueWhatsAppNotifications(tx, buildBookingNotificationIntents({
        snapshot: toSnapshot(booking, booking.id === bookings[0]!.id ? input.firstConfirmationToken : undefined),
        seriesId: booking.seriesId ?? undefined, event: input.event, actor: input.actor, requestId: input.requestId,
      }));
    }
    return count;
  }
  const snapshots = bookings.map((booking, index) => toSnapshot(booking, index === 0 ? input.firstConfirmationToken : undefined));
  return enqueueWhatsAppNotifications(tx, buildSeriesNotificationIntents({
    seriesId: input.seriesId, occurrences: snapshots, event: input.event, actor: input.actor, requestId: input.requestId,
  }));
}

/** Enqueues inside the caller's transaction: nothing exists for the worker until the booking commits. */
export async function enqueueBookingNotification(
  tx: Prisma.TransactionClient,
  input: {
    bookingId: string;
    event: BookingEvent;
    actor?: BookingChangeActor;
    confirmationToken?: string;
    requestId?: string;
  },
): Promise<number> {
  const booking = await tx.booking.findUnique({
    where: { id: input.bookingId },
    include: BOOKING_SNAPSHOT_INCLUDE,
  });
  if (!booking) throw new Error(`Booking ${input.bookingId} not found while creating notification intent`);
  const intents = buildBookingNotificationIntents({
    snapshot: toSnapshot(booking, input.confirmationToken),
    seriesId: booking.seriesId ?? undefined,
    event: input.event,
    actor: input.actor,
    requestId: input.requestId,
  });
  return enqueueWhatsAppNotifications(tx, intents);
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
      await enqueueBookingNotification(tx, { bookingId: booking.id, event: "BOOKING_REMINDER", requestId });
    }
    return bookings.length;
  });
}
