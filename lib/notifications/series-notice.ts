import { createHash } from "node:crypto";
import type { NotificationDelivery, Prisma } from "@prisma/client";
import { bookingAudienceFromKey } from "@/lib/notifications/validity-policy";
import { buildSeriesNotificationMessage, type BookingNotificationSnapshot } from "@/lib/whatsapp";

// A series creation notice is enqueued with the occurrences as they were at commit time.
// Before it is sent, occurrences may be cancelled, moved out of the series, confirmed or pass.
// The summary is therefore rebuilt from the series' current state right before the provider call.

type SeriesNoticeRow = Pick<NotificationDelivery, "event" | "idempotencyKey" | "bookingId" | "seriesId" | "message">;
type RenderDb = Pick<Prisma.TransactionClient, "booking">;

const CONFIRMATION_LINK = /https?:\/\/\S+?\/confirmar-agendamento\?token=([A-Za-z0-9_%-]+)/;

export function isSeriesCreationNotice(row: Pick<NotificationDelivery, "event" | "idempotencyKey">): boolean {
  return (row.event === "BOOKING_CREATED_BY_CLIENT" || row.event === "BOOKING_CREATED_BY_STAFF")
    && row.idempotencyKey.startsWith("series:");
}

/**
 * Current text of a series creation notice, or null when no upcoming active occurrence is left.
 * The confirmation link enqueued for one occurrence is kept only while it can still confirm it:
 * same token (hash matches), occurrence still in the series, pending, unused and unexpired.
 */
export async function renderSeriesCreationNotice(db: RenderDb, row: SeriesNoticeRow, now: Date): Promise<string | null> {
  if (!row.seriesId || !isSeriesCreationNotice(row)) return null;
  const bookings = await db.booking.findMany({
    where: { seriesId: row.seriesId, status: { in: ["PENDENTE", "CONFIRMADO"] }, dateTimeStart: { gt: now } },
    include: { service: { select: { name: true, priceCents: true } }, barber: { select: { name: true } } },
    orderBy: { dateTimeStart: "asc" },
  });
  if (!bookings.length) return null;
  const snapshot = (booking: (typeof bookings)[number]): BookingNotificationSnapshot => ({
    id: booking.id, customerName: booking.customerName, customerPhone: booking.customerPhone,
    observations: booking.observations, dateTimeStart: booking.dateTimeStart.toISOString(), status: booking.status,
    service: booking.service, barber: booking.barber,
  });
  const audience = bookingAudienceFromKey(row.idempotencyKey) ?? "CLIENT";

  let confirmation: { link: string; occurrence: BookingNotificationSnapshot } | null = null;
  const match = audience === "CLIENT" && row.event === "BOOKING_CREATED_BY_STAFF" ? CONFIRMATION_LINK.exec(row.message) : null;
  const target = match ? bookings.find((booking) => booking.id === row.bookingId) : undefined;
  if (match && target && target.status === "PENDENTE" && !target.confirmationTokenUsedAt
    && target.confirmationTokenExpiresAt && target.confirmationTokenExpiresAt > now
    && target.confirmationTokenHash === createHash("sha256").update(decodeURIComponent(match[1]!)).digest("hex")) {
    confirmation = { link: match[0], occurrence: snapshot(target) };
  }

  return buildSeriesNotificationMessage({
    event: row.event as "BOOKING_CREATED_BY_CLIENT" | "BOOKING_CREATED_BY_STAFF",
    audience, actor: "STAFF", occurrences: bookings.map(snapshot), seriesId: row.seriesId, confirmation,
  });
}
