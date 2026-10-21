import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { BUSINESS_CONFIG } from "@/lib/config";
import { calculateOccupancyRate, decodeBookingCursor, encodeBookingCursor } from "@/lib/query-contracts";
import type {
  BlockedSlot,
  BookingStatus,
  BookingWithRelations,
  DateRangeResponse,
  PaginatedResponse,
} from "@/types/domain";

const bookingListSelect = {
  id: true,
  barberId: true,
  serviceId: true,
  clientId: true,
  customerName: true,
  customerPhone: true,
  observations: true,
  dateTimeStart: true,
  dateTimeEnd: true,
  status: true,
  paymentStatus: true,
  paymentConfirmedAt: true,
  confirmationTokenExpiresAt: true,
  confirmationTokenUsedAt: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
  seriesId: true,
  occurrenceIndex: true,
  occurrenceLocalDate: true,
  barber: { select: { id: true, name: true, avatarUrl: true, isActive: true } },
  service: { select: { id: true, name: true, durationMinutes: true, isProcedure: true, priceCents: true, isActive: true } },
} satisfies Prisma.BookingSelect;

type SelectedBooking = Prisma.BookingGetPayload<{ select: typeof bookingListSelect }>;

function serializeBooking(row: SelectedBooking): BookingWithRelations {
  return {
    id: row.id,
    barberId: row.barberId,
    serviceId: row.serviceId,
    clientId: row.clientId ?? undefined,
    customerName: row.customerName,
    customerPhone: row.customerPhone,
    observations: row.observations ?? undefined,
    dateTimeStart: row.dateTimeStart.toISOString(),
    dateTimeEnd: row.dateTimeEnd.toISOString(),
    status: row.status,
    paymentStatus: row.paymentStatus,
    paymentConfirmedAt: row.paymentConfirmedAt?.toISOString(),
    confirmationTokenExpiresAt: row.confirmationTokenExpiresAt?.toISOString(),
    confirmationTokenUsedAt: row.confirmationTokenUsedAt?.toISOString(),
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    seriesId: row.seriesId ?? undefined,
    occurrenceIndex: row.occurrenceIndex ?? undefined,
    occurrenceLocalDate: row.occurrenceLocalDate?.toISOString().slice(0, 10),
    barber: {
      id: row.barber.id,
      name: row.barber.name,
      avatarUrl: row.barber.avatarUrl ?? undefined,
      isActive: row.barber.isActive,
    },
    service: row.service,
  };
}

function cursorWhere(value: string, direction: "asc" | "desc"): Prisma.BookingWhereInput {
  const cursor = decodeBookingCursor(value);
  const dateTimeStart = new Date(cursor.dateTimeStart);
  const comparator = direction === "asc" ? "gt" : "lt";
  return {
    OR: [
      { dateTimeStart: { [comparator]: dateTimeStart } },
      { dateTimeStart, id: { [comparator]: cursor.id } },
    ],
  };
}

export type BookingRangeQuery = {
  start: string;
  end: string;
  barberId?: string;
  status?: BookingStatus | "TODOS";
  client?: string;
  updatedAfter?: string;
  cursor?: string;
  limit: number;
};

export async function listBookingRange(query: BookingRangeQuery): Promise<DateRangeResponse<BookingWithRelations>> {
  const requestStartedAt = new Date();
  const where: Prisma.BookingWhereInput = {
    dateTimeStart: { gte: new Date(query.start), lte: new Date(query.end) },
    ...(query.barberId ? { barberId: query.barberId } : {}),
    ...(query.status && query.status !== "TODOS" ? { status: query.status } : {}),
    ...(query.updatedAfter ? { updatedAt: { gt: new Date(query.updatedAfter) } } : {}),
    ...(query.client
      ? {
          OR: [
            { customerName: { contains: query.client, mode: "insensitive" } },
            { customerPhone: { contains: query.client } },
          ],
        }
      : {}),
    ...(query.cursor ? { AND: [cursorWhere(query.cursor, "asc")] } : {}),
  };
  const rows = await prisma.booking.findMany({
    where,
    select: bookingListSelect,
    orderBy: [{ dateTimeStart: "asc" }, { id: "asc" }],
    take: query.limit + 1,
  });
  const hasMore = rows.length > query.limit;
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);

  return {
    data: page.map(serializeBooking),
    hasMore,
    nextCursor: hasMore && last
      ? encodeBookingCursor({ dateTimeStart: last.dateTimeStart.toISOString(), id: last.id })
      : null,
    range: { start: query.start, end: query.end },
    lastUpdatedAt: requestStartedAt.toISOString(),
  };
}

export async function listUpcomingClientBookings(clientId: string, limit = 10) {
  const [rows, total] = await Promise.all([
    prisma.booking.findMany({
      where: { clientId, status: { not: "CANCELADO" }, dateTimeStart: { gte: new Date() } },
      select: bookingListSelect,
      orderBy: [{ dateTimeStart: "asc" }, { id: "asc" }],
      take: Math.min(20, Math.max(1, limit)),
    }),
    prisma.booking.count({ where: { clientId, status: { not: "CANCELADO" }, dateTimeStart: { gte: new Date() } } }),
  ]);
  return { data: rows.map(serializeBooking), total };
}

export async function getBlockedSlotsOverview(options: { barberId?: string; limit?: number } = {}) {
  const now = new Date();
  const barberWhere = options.barberId ? { barberId: options.barberId } : {};
  const [rows, expiredCount] = await Promise.all([
    prisma.blockedSlot.findMany({
      where: { dateTimeEnd: { gte: now }, ...barberWhere },
      orderBy: [{ dateTimeStart: "asc" }, { id: "asc" }],
      take: Math.min(250, Math.max(1, options.limit ?? 100)),
    }),
    prisma.blockedSlot.count({ where: { dateTimeEnd: { lt: now }, ...barberWhere } }),
  ]);
  const data: BlockedSlot[] = rows.map((row) => ({
    id: row.id,
    barberId: row.barberId ?? undefined,
    dateTimeStart: row.dateTimeStart.toISOString(),
    dateTimeEnd: row.dateTimeEnd.toISOString(),
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
  }));
  return { data, expiredCount };
}

export async function listClientBookingHistory(
  clientId: string,
  options: { cursor?: string; limit: number },
): Promise<PaginatedResponse<BookingWithRelations>> {
  const now = new Date();
  const rows = await prisma.booking.findMany({
    where: {
      clientId,
      AND: [
        { OR: [{ status: "CANCELADO" }, { dateTimeStart: { lt: now } }] },
        ...(options.cursor ? [cursorWhere(options.cursor, "desc")] : []),
      ],
    },
    select: bookingListSelect,
    orderBy: [{ dateTimeStart: "desc" }, { id: "desc" }],
    take: options.limit + 1,
  });
  const hasMore = rows.length > options.limit;
  const page = rows.slice(0, options.limit);
  const last = page.at(-1);
  return {
    data: page.map(serializeBooking),
    hasMore,
    nextCursor: hasMore && last
      ? encodeBookingCursor({ dateTimeStart: last.dateTimeStart.toISOString(), id: last.id })
      : null,
  };
}

export type DashboardData = {
  todayTotal: number;
  todayConfirmed: number;
  todayPending: number;
  todayRevenueCents: number;
  occupancyRate: number;
  futureActiveTotal: number;
  activeBlockedTotal: number;
  allBookingsTotal: number;
  upcomingBookings: BookingWithRelations[];
  recentBookings: BookingWithRelations[];
};

type DashboardRevenueRow = { totalCents: bigint | number | null; bookedMinutes: number | null };

function minutesBetweenTimes(openTime: string, closeTime: string): number {
  const [openHour, openMinute] = openTime.split(":").map(Number);
  const [closeHour, closeMinute] = closeTime.split(":").map(Number);
  return Math.max(0, (closeHour * 60 + closeMinute) - (openHour * 60 + openMinute));
}

export async function getAdminDashboardData(dayStart: string, dayEnd: string): Promise<DashboardData> {
  const now = new Date();
  const range = { gte: new Date(dayStart), lte: new Date(dayEnd) };
  const businessDate = new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_CONFIG.timezone }).format(new Date(dayStart));
  const dayOfWeek = new Date(`${businessDate}T12:00:00Z`).getUTCDay();
  const [statusGroups, revenueRows, futureActiveTotal, activeBlockedTotal, allBookingsTotal, upcoming, recent, activeBarbers, availabilityRows] = await Promise.all([
    prisma.booking.groupBy({ by: ["status"], where: { dateTimeStart: range }, _count: { _all: true } }),
    prisma.$queryRaw<DashboardRevenueRow[]>`
      SELECT
        COALESCE(SUM(s."priceCents") FILTER (
          WHERE b.status <> 'CANCELADO'::"BookingStatus"
            AND b."paymentStatus" = 'CONFIRMADO'::"BookingPaymentStatus"
        ), 0)::bigint AS "totalCents",
        COALESCE(SUM(EXTRACT(EPOCH FROM (b."dateTimeEnd" - b."dateTimeStart")) / 60) FILTER (
          WHERE b.status <> 'CANCELADO'::"BookingStatus"
        ), 0)::double precision AS "bookedMinutes"
      FROM "Booking" b
      INNER JOIN "Service" s ON s.id = b."serviceId"
      WHERE b."dateTimeStart" >= ${new Date(dayStart)}
        AND b."dateTimeStart" <= ${new Date(dayEnd)}
    `,
    prisma.booking.count({ where: { status: { not: "CANCELADO" }, dateTimeStart: { gte: now } } }),
    prisma.blockedSlot.count({ where: { dateTimeEnd: { gte: now } } }),
    prisma.booking.count(),
    prisma.booking.findMany({
      where: { status: { not: "CANCELADO" }, dateTimeStart: { gte: now } },
      select: bookingListSelect,
      orderBy: [{ dateTimeStart: "asc" }, { id: "asc" }],
      take: 8,
    }),
    prisma.booking.findMany({
      select: bookingListSelect,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 7,
    }),
    prisma.barber.findMany({ where: { isActive: true }, select: { id: true }, take: 100 }),
    prisma.barberAvailability.findMany({
      where: { dayOfWeek, barber: { isActive: true } },
      select: { barberId: true, openTime: true, closeTime: true },
      take: 500,
    }),
  ]);
  const counts = new Map(statusGroups.map((row) => [row.status, row._count._all]));
  const availabilityByBarber = new Map<string, number>();
  for (const row of availabilityRows) {
    availabilityByBarber.set(
      row.barberId,
      (availabilityByBarber.get(row.barberId) ?? 0) + minutesBetweenTimes(row.openTime, row.closeTime),
    );
  }
  const defaultAvailableMinutes = BUSINESS_CONFIG.operatingHours
    .filter((row) => row.dayOfWeek === dayOfWeek)
    .reduce((sum, row) => sum + minutesBetweenTimes(row.open, row.close), 0);
  const availableMinutes = activeBarbers.reduce(
    (sum, barber) => sum + (availabilityByBarber.has(barber.id) ? availabilityByBarber.get(barber.id)! : defaultAvailableMinutes),
    0,
  );
  const bookedMinutes = Number(revenueRows[0]?.bookedMinutes ?? 0);
  return {
    todayTotal: statusGroups.reduce((sum, row) => sum + row._count._all, 0),
    todayConfirmed: counts.get("CONFIRMADO") ?? 0,
    todayPending: counts.get("PENDENTE") ?? 0,
    todayRevenueCents: Number(revenueRows[0]?.totalCents ?? 0),
    occupancyRate: calculateOccupancyRate(bookedMinutes, availableMinutes),
    futureActiveTotal,
    activeBlockedTotal,
    allBookingsTotal,
    upcomingBookings: upcoming.map(serializeBooking),
    recentBookings: recent.map(serializeBooking),
  };
}

export type RevenueGroup = { key: string; label: string; totalCents: number; bookingsCount: number };
export type EarningsData = {
  totalConfirmedCents: number;
  pendingPotentialCents: number;
  confirmedCount: number;
  cancellationsCount: number;
  dailyRevenue: RevenueGroup[];
  serviceRevenue: RevenueGroup[];
  barberRevenue: RevenueGroup[];
  recentConfirmedBookings: BookingWithRelations[];
};

type EarningsSummaryRow = {
  totalConfirmedCents: bigint | number | null;
  pendingPotentialCents: bigint | number | null;
  confirmedCount: bigint | number;
  cancellationsCount: bigint | number;
};
type RevenueSqlRow = { key: string; label: string; totalCents: bigint | number; bookingsCount: bigint | number };

export async function getEarningsData(input: { start: string; end: string; barberId?: string }): Promise<EarningsData> {
  const start = new Date(input.start);
  const end = new Date(input.end);
  const barberFilter = input.barberId ? Prisma.sql`AND b."barberId" = ${input.barberId}` : Prisma.empty;
  const [summaryRows, dailyRows, serviceRows, barberRows, recentRows] = await Promise.all([
    prisma.$queryRaw<EarningsSummaryRow[]>`
      SELECT
        COALESCE(SUM(s."priceCents") FILTER (WHERE b.status <> 'CANCELADO'::"BookingStatus" AND b."paymentStatus" = 'CONFIRMADO'::"BookingPaymentStatus"), 0)::bigint AS "totalConfirmedCents",
        COALESCE(SUM(s."priceCents") FILTER (WHERE b.status <> 'CANCELADO'::"BookingStatus" AND b."paymentStatus" = 'PENDENTE'::"BookingPaymentStatus"), 0)::bigint AS "pendingPotentialCents",
        COUNT(*) FILTER (WHERE b.status <> 'CANCELADO'::"BookingStatus" AND b."paymentStatus" = 'CONFIRMADO'::"BookingPaymentStatus")::bigint AS "confirmedCount",
        COUNT(*) FILTER (WHERE b.status = 'CANCELADO'::"BookingStatus")::bigint AS "cancellationsCount"
      FROM "Booking" b
      INNER JOIN "Service" s ON s.id = b."serviceId"
      WHERE b."dateTimeStart" >= ${start} AND b."dateTimeStart" <= ${end}
      ${barberFilter}
    `,
    prisma.$queryRaw<RevenueSqlRow[]>`
      SELECT
        TO_CHAR((b."dateTimeStart" AT TIME ZONE 'UTC') AT TIME ZONE ${BUSINESS_CONFIG.timezone}, 'YYYY-MM-DD') AS key,
        TO_CHAR((b."dateTimeStart" AT TIME ZONE 'UTC') AT TIME ZONE ${BUSINESS_CONFIG.timezone}, 'DD/MM/YYYY') AS label,
        SUM(s."priceCents")::bigint AS "totalCents",
        COUNT(*)::bigint AS "bookingsCount"
      FROM "Booking" b INNER JOIN "Service" s ON s.id = b."serviceId"
      WHERE b."dateTimeStart" >= ${start} AND b."dateTimeStart" <= ${end}
        AND b.status <> 'CANCELADO'::"BookingStatus" AND b."paymentStatus" = 'CONFIRMADO'::"BookingPaymentStatus"
        ${barberFilter}
      GROUP BY key, label ORDER BY key ASC
    `,
    prisma.$queryRaw<RevenueSqlRow[]>`
      SELECT s.id AS key, s.name AS label, SUM(s."priceCents")::bigint AS "totalCents", COUNT(*)::bigint AS "bookingsCount"
      FROM "Booking" b INNER JOIN "Service" s ON s.id = b."serviceId"
      WHERE b."dateTimeStart" >= ${start} AND b."dateTimeStart" <= ${end}
        AND b.status <> 'CANCELADO'::"BookingStatus" AND b."paymentStatus" = 'CONFIRMADO'::"BookingPaymentStatus"
        ${barberFilter}
      GROUP BY s.id, s.name ORDER BY "totalCents" DESC
    `,
    prisma.$queryRaw<RevenueSqlRow[]>`
      SELECT br.id AS key, br.name AS label, SUM(s."priceCents")::bigint AS "totalCents", COUNT(*)::bigint AS "bookingsCount"
      FROM "Booking" b INNER JOIN "Service" s ON s.id = b."serviceId" INNER JOIN "Barber" br ON br.id = b."barberId"
      WHERE b."dateTimeStart" >= ${start} AND b."dateTimeStart" <= ${end}
        AND b.status <> 'CANCELADO'::"BookingStatus" AND b."paymentStatus" = 'CONFIRMADO'::"BookingPaymentStatus"
        ${barberFilter}
      GROUP BY br.id, br.name ORDER BY "totalCents" DESC
    `,
    prisma.booking.findMany({
      where: {
        dateTimeStart: { gte: start, lte: end },
        status: { not: "CANCELADO" },
        paymentStatus: "CONFIRMADO",
        ...(input.barberId ? { barberId: input.barberId } : {}),
      },
      select: bookingListSelect,
      orderBy: [{ paymentConfirmedAt: "desc" }, { id: "desc" }],
      take: 20,
    }),
  ]);
  const summary = summaryRows[0];
  const mapGroup = (row: RevenueSqlRow): RevenueGroup => ({
    key: row.key,
    label: row.label,
    totalCents: Number(row.totalCents),
    bookingsCount: Number(row.bookingsCount),
  });
  return {
    totalConfirmedCents: Number(summary?.totalConfirmedCents ?? 0),
    pendingPotentialCents: Number(summary?.pendingPotentialCents ?? 0),
    confirmedCount: Number(summary?.confirmedCount ?? 0),
    cancellationsCount: Number(summary?.cancellationsCount ?? 0),
    dailyRevenue: dailyRows.map(mapGroup),
    serviceRevenue: serviceRows.map(mapGroup),
    barberRevenue: barberRows.map(mapGroup),
    recentConfirmedBookings: recentRows.map(serializeBooking),
  };
}
