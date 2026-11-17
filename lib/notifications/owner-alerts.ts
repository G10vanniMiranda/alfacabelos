import { randomUUID } from "node:crypto";
import type { NotificationEvent, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAuditEvent } from "@/lib/observability/audit";

/**
 * Persistent alerts for the shop owner in the admin panel. The business has a single WhatsApp
 * number (sender = owner), so the owner cannot rely on WhatsApp messages to themself; every
 * booking change is also written to the append-only audit log inside the booking transaction.
 */
export const OWNER_ALERT_EVENTS = [
  "BOOKING_CREATED_BY_CLIENT",
  "BOOKING_CREATED_BY_STAFF",
  "BOOKING_CANCELLED",
  "BOOKING_RESCHEDULED",
] as const satisfies readonly NotificationEvent[];

export type OwnerAlertEvent = (typeof OWNER_ALERT_EVENTS)[number];
const ACTION_PREFIX = "owner_alert.";
const MAX_IDS = 20;

export function isOwnerAlertEvent(event: string): event is OwnerAlertEvent {
  return (OWNER_ALERT_EVENTS as readonly string[]).includes(event);
}

export async function recordOwnerAlert(tx: Prisma.TransactionClient, input: {
  event: string;
  bookingIds: string[];
  seriesId?: string | null;
  actor?: "CLIENT" | "STAFF";
  requestId?: string;
}): Promise<void> {
  if (!isOwnerAlertEvent(input.event) || !input.bookingIds.length) return;
  await recordAuditEvent(tx, {
    actorType: "SYSTEM",
    action: `${ACTION_PREFIX}${input.event}`,
    resourceType: "Booking",
    resourceId: input.bookingIds[0],
    requestId: input.requestId ?? randomUUID(),
    metadata: {
      bookingIds: input.bookingIds.slice(0, MAX_IDS),
      occurrences: input.bookingIds.length,
      seriesId: input.seriesId ?? null,
      actor: input.actor ?? null,
    },
  });
}

export type OwnerAlert = {
  id: string;
  event: OwnerAlertEvent;
  createdAt: string;
  occurrences: number;
  actor: "CLIENT" | "STAFF" | null;
  booking: { customerName: string; serviceName: string; start: string; status: string } | null;
};

export const OWNER_ALERT_WINDOW_DAYS = 7;
export const OWNER_ALERT_LIMIT = 30;

/** Recent alerts, newest first. A barber principal sees only alerts for their own bookings. */
export async function listOwnerAlerts(input: { barberId?: string; now?: Date } = {}): Promise<OwnerAlert[]> {
  const since = new Date((input.now ?? new Date()).getTime() - OWNER_ALERT_WINDOW_DAYS * 86_400_000);
  const rows = await prisma.auditLog.findMany({
    where: { action: { startsWith: ACTION_PREFIX }, createdAt: { gte: since } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: input.barberId ? OWNER_ALERT_LIMIT * 3 : OWNER_ALERT_LIMIT,
    select: { id: true, action: true, createdAt: true, resourceId: true, metadata: true },
  });
  const ids = [...new Set(rows.map((row) => row.resourceId).filter((id): id is string => Boolean(id)))];
  const bookings = ids.length ? await prisma.booking.findMany({
    where: { id: { in: ids } },
    select: { id: true, barberId: true, customerName: true, dateTimeStart: true, status: true, service: { select: { name: true } } },
  }) : [];
  const byId = new Map(bookings.map((booking) => [booking.id, booking]));

  const alerts: OwnerAlert[] = [];
  for (const row of rows) {
    const event = row.action.slice(ACTION_PREFIX.length);
    if (!isOwnerAlertEvent(event)) continue;
    const booking = row.resourceId ? byId.get(row.resourceId) : undefined;
    // Scoped principals never see alerts whose booking is gone or belongs to someone else.
    if (input.barberId && booking?.barberId !== input.barberId) continue;
    const metadata = (row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? row.metadata : {}) as Record<string, unknown>;
    alerts.push({
      id: row.id,
      event,
      createdAt: row.createdAt.toISOString(),
      occurrences: typeof metadata.occurrences === "number" ? metadata.occurrences : 1,
      actor: metadata.actor === "CLIENT" || metadata.actor === "STAFF" ? metadata.actor : null,
      booking: booking ? {
        customerName: booking.customerName,
        serviceName: booking.service.name,
        start: booking.dateTimeStart.toISOString(),
        status: booking.status,
      } : null,
    });
    if (alerts.length >= OWNER_ALERT_LIMIT) break;
  }
  return alerts;
}
