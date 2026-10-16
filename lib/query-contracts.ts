import { z } from "zod";
import { BUSINESS_CONFIG } from "@/lib/config";
import { getDayRangeIso, getTodayInTimeZone } from "@/lib/utils";
import type { BookingStatus, BookingWithRelations } from "@/types/domain";

export const ADMIN_BOOKINGS_DEFAULT_LIMIT = 200;
export const ADMIN_BOOKINGS_MAX_LIMIT = 500;
export const ADMIN_BOOKINGS_MAX_RANGE_DAYS = 31;
export const CLIENT_HISTORY_PAGE_SIZE = 12;
export const CLIENT_HISTORY_MAX_LIMIT = 24;

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const isoDateSchema = z.string().datetime({ offset: true });
const bookingStatusSchema = z.enum(["PENDENTE", "CONFIRMADO", "CANCELADO", "CONCLUIDO", "AUSENTE", "TODOS"]);

const adminBookingsQuerySchema = z.object({
  date: dateSchema.optional(),
  start: isoDateSchema.optional(),
  end: isoDateSchema.optional(),
  barberId: z.string().trim().min(1).max(100).optional(),
  status: bookingStatusSchema.default("TODOS"),
  client: z.string().trim().min(1).max(80).optional(),
  updatedAfter: isoDateSchema.optional(),
  cursor: z.string().trim().min(1).max(500).optional(),
  limit: z.coerce.number().int().min(1).max(ADMIN_BOOKINGS_MAX_LIMIT).default(ADMIN_BOOKINGS_DEFAULT_LIMIT),
}).superRefine((value, context) => {
  if ((value.start && !value.end) || (!value.start && value.end)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "start e end devem ser informados juntos" });
  }
  if (value.date && (value.start || value.end)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "use date ou start/end, não ambos" });
  }
});

export type AdminBookingsQuery = {
  start: string;
  end: string;
  barberId?: string;
  status: BookingStatus | "TODOS";
  client?: string;
  updatedAfter?: string;
  cursor?: string;
  limit: number;
};

function differenceInDays(start: string, end: string): number {
  return (new Date(end).getTime() - new Date(start).getTime()) / 86_400_000;
}

export function parseAdminBookingsQuery(searchParams: URLSearchParams): AdminBookingsQuery {
  const parsed = adminBookingsQuerySchema.parse(Object.fromEntries(searchParams.entries()));
  const fallbackDate = parsed.date ?? getTodayInTimeZone(BUSINESS_CONFIG.timezone);
  const fallbackRange = getDayRangeIso(fallbackDate, BUSINESS_CONFIG.timezone);
  const start = parsed.start ?? fallbackRange.start;
  const end = parsed.end ?? fallbackRange.end;

  if (new Date(start) >= new Date(end)) {
    throw new Error("O início do intervalo deve ser anterior ao fim");
  }
  if (differenceInDays(start, end) > ADMIN_BOOKINGS_MAX_RANGE_DAYS) {
    throw new Error(`O intervalo máximo é de ${ADMIN_BOOKINGS_MAX_RANGE_DAYS} dias`);
  }

  return {
    start,
    end,
    barberId: parsed.barberId,
    status: parsed.status,
    client: parsed.client,
    updatedAfter: parsed.updatedAfter,
    cursor: parsed.cursor,
    limit: parsed.limit,
  };
}

type BookingCursor = { dateTimeStart: string; id: string };

export function encodeBookingCursor(cursor: BookingCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeBookingCursor(value: string): BookingCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    return z.object({ dateTimeStart: isoDateSchema, id: z.string().min(1).max(100) }).parse(parsed);
  } catch {
    throw new Error("Cursor inválido");
  }
}

export function mergeBookingChanges(
  current: BookingWithRelations[],
  changes: BookingWithRelations[],
): BookingWithRelations[] {
  const byId = new Map(current.map((booking) => [booking.id, booking]));
  for (const booking of changes) byId.set(booking.id, booking);
  return Array.from(byId.values()).sort((left, right) => {
    const byStart = new Date(left.dateTimeStart).getTime() - new Date(right.dateTimeStart).getTime();
    return byStart || left.id.localeCompare(right.id);
  });
}

export function getAgendaPollingDelay(visibility: "visible" | "hidden", failureCount: number): number {
  const baseDelay = visibility === "visible" ? 15_000 : 60_000;
  return Math.min(120_000, baseDelay * (2 ** Math.min(3, Math.max(0, failureCount))));
}

export function shouldUseIncrementalPolling(pollCount: number): boolean {
  return Math.max(1, Math.trunc(pollCount)) % 4 !== 0;
}

export function calculateOccupancyRate(bookedMinutes: number, availableMinutes: number): number {
  if (availableMinutes <= 0 || bookedMinutes <= 0) return 0;
  return Math.min(100, Math.round((bookedMinutes / availableMinutes) * 100));
}
