import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { BUSINESS_CONFIG } from "@/lib/config";
import { CLOSED_DAY_TIME } from "@/lib/constants/availability";
import { getDayRangeIso } from "@/lib/utils";
import { sha256 } from "@/lib/security";
import { isDatabaseUnavailableError } from "@/lib/errors";
import { Barber, BarberAvailability, Booking, BookingWithRelations, BlockedSlot, GalleryImage } from "@/types/domain";
import { BookingRepository, CreateBlockedSlotInput, CreateBookingInput, CreateGalleryImageInput, UpdateBookingInput } from "./types";

type BookingRow = {
  id: string;
  barberId: string;
  serviceId: string;
  clientId?: string | null;
  customerName: string;
  customerPhone: string;
  observations?: string | null;
  dateTimeStart: Date;
  dateTimeEnd: Date;
  status: "PENDENTE" | "CONFIRMADO" | "CANCELADO" | "CONCLUIDO" | "AUSENTE";
  paymentStatus?: "PENDENTE" | "CONFIRMADO" | null;
  paymentConfirmedAt?: Date | null;
  confirmationToken?: string | null;
  confirmationTokenHash?: string | null;
  confirmationTokenExpiresAt?: Date | null;
  confirmationTokenUsedAt?: Date | null;
  createdBy?: "BARBER" | "CLIENT" | null;
  createdAt: Date;
  seriesId?: string | null;
  occurrenceIndex?: number | null;
  occurrenceLocalDate?: Date | null;
};

type BookingWithRelationsRow = BookingRow & {
  barberName: string;
  barberAvatarUrl: string | null;
  barberIsActive: boolean;
  serviceName: string;
  serviceDurationMinutes: number;
  serviceIsProcedure: boolean;
  servicePriceCents: number;
  serviceIsActive: boolean;
};

function toBooking(row: BookingRow): Booking {
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
    paymentStatus: row.paymentStatus ?? "PENDENTE",
    paymentConfirmedAt: row.paymentConfirmedAt?.toISOString(),
    confirmationToken: row.confirmationToken ?? undefined,
    confirmationTokenExpiresAt: row.confirmationTokenExpiresAt?.toISOString(),
    confirmationTokenUsedAt: row.confirmationTokenUsedAt?.toISOString(),
    createdBy: row.createdBy ?? "CLIENT",
    createdAt: row.createdAt.toISOString(),
    seriesId: row.seriesId ?? undefined,
    occurrenceIndex: row.occurrenceIndex ?? undefined,
    occurrenceLocalDate: row.occurrenceLocalDate?.toISOString().slice(0, 10),
  };
}

function toBookingWithRelations(row: BookingWithRelationsRow): BookingWithRelations {
  return {
    ...toBooking(row),
    barber: {
      id: row.barberId,
      name: row.barberName,
      avatarUrl: row.barberAvatarUrl ?? undefined,
      isActive: row.barberIsActive,
    },
    service: {
      id: row.serviceId,
      name: row.serviceName,
      durationMinutes: row.serviceDurationMinutes,
      isProcedure: row.serviceIsProcedure,
      priceCents: row.servicePriceCents,
      isActive: row.serviceIsActive,
    },
  };
}

function toBlockedSlot(row: {
  id: string;
  barberId: string | null;
  dateTimeStart: Date;
  dateTimeEnd: Date;
  reason: string;
  createdAt: Date;
}): BlockedSlot {
  return {
    id: row.id,
    barberId: row.barberId ?? undefined,
    dateTimeStart: row.dateTimeStart.toISOString(),
    dateTimeEnd: row.dateTimeEnd.toISOString(),
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
  };
}

function toBarber(row: {
  id: string;
  name: string;
  avatarUrl: string | null;
  isActive: boolean;
}): Barber {
  return {
    id: row.id,
    name: row.name,
    avatarUrl: row.avatarUrl ?? undefined,
    isActive: row.isActive,
  };
}

function toGalleryImage(row: {
  id: string;
  imageUrl: string;
  altText: string | null;
  mediaType?: string | null;
  createdAt: Date;
}): GalleryImage {
  return {
    id: row.id,
    imageUrl: row.imageUrl,
    altText: row.altText ?? undefined,
    mediaType: row.mediaType === "VIDEO" ? "VIDEO" : "IMAGE",
    createdAt: row.createdAt.toISOString(),
  };
}

function toBarberAvailability(row: {
  id: string;
  barberId: string;
  dayOfWeek: number;
  openTime: string;
  closeTime: string;
  createdAt: Date;
  updatedAt: Date;
}): BarberAvailability {
  return {
    id: row.id,
    barberId: row.barberId,
    dayOfWeek: row.dayOfWeek,
    openTime: row.openTime,
    closeTime: row.closeTime,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function defaultAvailabilitiesForMissingDays(barberId: string, savedDays: Set<number>): BarberAvailability[] {
  return BUSINESS_CONFIG.operatingHours
    .filter((slot) => !savedDays.has(slot.dayOfWeek))
    .map((slot) => ({
      id: `default-${barberId}-${slot.dayOfWeek}-${slot.open}-${slot.close}`,
      barberId,
      dayOfWeek: slot.dayOfWeek,
      openTime: slot.open,
      closeTime: slot.close,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
}

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

function toClientUser(row: {
  id: string;
  name: string;
  phone: string;
  hasPassword?: boolean | null;
  status?: "PENDING" | "ACTIVE" | null;
  createdBy?: "BARBER" | "CLIENT" | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    hasPassword: row.hasPassword ?? true,
    status: row.status ?? "ACTIVE",
    createdBy: row.createdBy ?? "CLIENT",
    createdAt: row.createdAt.toISOString(),
  };
}

let galleryTableChecked = false;
let galleryTableExists = false;
let availabilityTableChecked = false;
let availabilityTableExists = false;
let bookingPaymentColumnsChecked = false;
let bookingPaymentColumnsExist = false;
let bookingSeriesColumnsChecked = false;
let bookingSeriesColumnsExist = false;

function getGalleryDelegate() {
  return (prisma as unknown as {
    galleryImage?: {
      findMany: (args: unknown) => Promise<
        Array<{ id: string; imageUrl: string; altText: string | null; mediaType?: string | null; createdAt: Date }>
      >;
      create: (args: unknown) => Promise<{
        id: string;
        imageUrl: string;
        altText: string | null;
        mediaType?: string | null;
        createdAt: Date;
      }>;
      deleteMany: (args: unknown) => Promise<{ count: number }>;
    }
  }).galleryImage;
}

function getBarberAvailabilityDelegate() {
  return (prisma as unknown as {
    barberAvailability?: {
      findMany: (args: unknown) => Promise<
        Array<{
          id: string;
          barberId: string;
          dayOfWeek: number;
          openTime: string;
          closeTime: string;
          createdAt: Date;
          updatedAt: Date;
        }>
      >;
      createMany: (args: unknown) => Promise<{ count: number }>;
      deleteMany: (args: unknown) => Promise<{ count: number }>;
    };
  }).barberAvailability;
}

function isGalleryTableMissing(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const maybe = error as { code?: string; message?: string };
  if (maybe.code === "P2021") {
    return true;
  }

  return typeof maybe.message === "string" && maybe.message.includes("GalleryImage") && maybe.message.includes("does not exist");
}

function isBarberAvailabilityTableMissing(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const maybe = error as { code?: string; message?: string };
  if (maybe.code === "P2021") {
    return true;
  }

  return (
    typeof maybe.message === "string" &&
    maybe.message.includes("BarberAvailability") &&
    maybe.message.includes("does not exist")
  );
}

function isSerializableTransactionConflict(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2034");
}

async function ensureGalleryTableExists(): Promise<boolean> {
  if (galleryTableChecked) {
    return galleryTableExists;
  }

  try {
    const result = await prisma.$queryRaw<Array<{ exists: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'GalleryImage'
      ) AS "exists"
    `;
    galleryTableExists = result[0]?.exists === true;
  } catch (error) {
    if (isDatabaseUnavailableError(error)) throw error;
    galleryTableExists = false;
  } finally {
    galleryTableChecked = true;
  }

  return galleryTableExists;
}

async function ensureBarberAvailabilityTableExists(): Promise<boolean> {
  if (availabilityTableChecked) {
    return availabilityTableExists;
  }

  try {
    const result = await prisma.$queryRaw<Array<{ exists: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'BarberAvailability'
      ) AS "exists"
    `;
    availabilityTableExists = result[0]?.exists === true;
  } catch (error) {
    if (isDatabaseUnavailableError(error)) throw error;
    availabilityTableExists = false;
  } finally {
    availabilityTableChecked = true;
  }

  return availabilityTableExists;
}

async function ensureBookingPaymentColumnsExist(): Promise<boolean> {
  if (bookingPaymentColumnsChecked) {
    return bookingPaymentColumnsExist;
  }

  try {
    const result = await prisma.$queryRaw<Array<{ columns: number }>>`
      SELECT COUNT(*)::int AS "columns"
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'Booking'
          AND column_name IN ('paymentStatus', 'clientId', 'observations', 'confirmationToken', 'confirmationTokenHash')
    `;
    bookingPaymentColumnsExist = Number(result[0]?.columns ?? 0) === 5;
  } catch (error) {
    if (isDatabaseUnavailableError(error)) throw error;
    bookingPaymentColumnsExist = false;
  } finally {
    bookingPaymentColumnsChecked = true;
  }

  return bookingPaymentColumnsExist;
}

async function ensureBookingSeriesColumnsExist(): Promise<boolean> {
  if (bookingSeriesColumnsChecked) return bookingSeriesColumnsExist;
  try {
    const result = await prisma.$queryRaw<Array<{ columns: number }>>`
      SELECT COUNT(*)::int AS "columns"
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'Booking'
        AND column_name IN ('seriesId', 'occurrenceIndex', 'occurrenceLocalDate')
    `;
    bookingSeriesColumnsExist = Number(result[0]?.columns ?? 0) === 3;
  } catch (error) {
    if (isDatabaseUnavailableError(error)) throw error;
    bookingSeriesColumnsExist = false;
  } finally {
    bookingSeriesColumnsChecked = true;
  }
  return bookingSeriesColumnsExist;
}

function bookingSeriesColumnsSql(exist: boolean) {
  return exist
    ? Prisma.sql`b."seriesId", b."occurrenceIndex", b."occurrenceLocalDate",`
    : Prisma.sql`NULL::text AS "seriesId", NULL::integer AS "occurrenceIndex", NULL::date AS "occurrenceLocalDate",`;
}

async function getBookingWithRelationsById(id: string): Promise<BookingWithRelations | undefined> {
  const hasPaymentColumns = await ensureBookingPaymentColumnsExist();
  const seriesColumns = bookingSeriesColumnsSql(await ensureBookingSeriesColumnsExist());
  const rows = hasPaymentColumns
    ? await prisma.$queryRaw<BookingWithRelationsRow[]>`
        SELECT
          b.id,
          b."barberId",
          b."serviceId",
          b."clientId",
          b."customerName",
          b."customerPhone",
          b."observations",
          b."dateTimeStart",
          b."dateTimeEnd",
          b.status::text AS status,
          COALESCE(b."paymentStatus"::text, 'PENDENTE') AS "paymentStatus",
          b."paymentConfirmedAt",
          b."confirmationToken",
          b."confirmationTokenHash",
          b."confirmationTokenExpiresAt",
          b."confirmationTokenUsedAt",
          b."createdBy"::text AS "createdBy",
          b."createdAt",
          ${seriesColumns}
          br.name AS "barberName",
          br."avatarUrl" AS "barberAvatarUrl",
          br."isActive" AS "barberIsActive",
          s.name AS "serviceName",
          s."durationMinutes" AS "serviceDurationMinutes",
          s."isProcedure" AS "serviceIsProcedure",
          s."priceCents" AS "servicePriceCents",
          s."isActive" AS "serviceIsActive"
        FROM "Booking" b
        INNER JOIN "Barber" br ON br.id = b."barberId"
        INNER JOIN "Service" s ON s.id = b."serviceId"
        WHERE b.id = ${id}
        LIMIT 1
      `
    : await prisma.$queryRaw<BookingWithRelationsRow[]>`
        SELECT
          b.id,
          b."barberId",
          b."serviceId",
          NULL::text AS "clientId",
          b."customerName",
          b."customerPhone",
          NULL::text AS "observations",
          b."dateTimeStart",
          b."dateTimeEnd",
          b.status::text AS status,
          'PENDENTE' AS "paymentStatus",
          NULL::timestamp AS "paymentConfirmedAt",
          NULL::text AS "confirmationToken",
          NULL::text AS "confirmationTokenHash",
          NULL::timestamp AS "confirmationTokenExpiresAt",
          NULL::timestamp AS "confirmationTokenUsedAt",
          'CLIENT' AS "createdBy",
          b."createdAt",
          ${seriesColumns}
          br.name AS "barberName",
          br."avatarUrl" AS "barberAvatarUrl",
          br."isActive" AS "barberIsActive",
          s.name AS "serviceName",
          s."durationMinutes" AS "serviceDurationMinutes",
          s."isProcedure" AS "serviceIsProcedure",
          s."priceCents" AS "servicePriceCents",
          s."isActive" AS "serviceIsActive"
        FROM "Booking" b
        INNER JOIN "Barber" br ON br.id = b."barberId"
        INNER JOIN "Service" s ON s.id = b."serviceId"
        WHERE b.id = ${id}
        LIMIT 1
      `;

  const row = rows[0];
  return row ? toBookingWithRelations(row) : undefined;
}

export const prismaRepository: BookingRepository = {
  async getServices() {
    return prisma.service.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
    });
  },

  async createService(input) {
    return prisma.service.create({
      data: {
        name: input.name,
        priceCents: input.priceCents,
        durationMinutes: input.durationMinutes,
        isProcedure: input.isProcedure,
        isActive: true,
      },
    });
  },

  async updateService(serviceId, input) {
    const existing = await prisma.service.findUnique({
      where: { id: serviceId },
    });
    if (!existing) {
      return undefined;
    }

    return prisma.service.update({
      where: { id: serviceId },
      data: {
        name: input.name,
        priceCents: input.priceCents,
        durationMinutes: input.durationMinutes,
        isProcedure: input.isProcedure,
      },
    });
  },

  async deleteService(serviceId) {
    const existing = await prisma.service.findUnique({
      where: { id: serviceId },
    });
    if (!existing) {
      return false;
    }

    await prisma.service.update({
      where: { id: serviceId },
      data: { isActive: false },
    });
    return true;
  },

  async getBarbers() {
    const rows = await prisma.barber.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
    });
    return rows.map(toBarber);
  },

  async getServiceById(id: string) {
    const service = await prisma.service.findFirst({
      where: { id, isActive: true },
    });
    return service ?? undefined;
  },

  async getBookingById(id: string) {
    return getBookingWithRelationsById(id);
  },

  async getBookingByConfirmationToken(token: string) {
    const hasPaymentColumns = await ensureBookingPaymentColumnsExist();
    const seriesColumns = bookingSeriesColumnsSql(await ensureBookingSeriesColumnsExist());
    const tokenHash = sha256(token);
    const rows = hasPaymentColumns
      ? await prisma.$queryRaw<BookingWithRelationsRow[]>`
          SELECT
            b.id,
            b."barberId",
            b."serviceId",
            b."clientId",
            b."customerName",
            b."customerPhone",
            b."observations",
            b."dateTimeStart",
            b."dateTimeEnd",
            b.status::text AS status,
            COALESCE(b."paymentStatus"::text, 'PENDENTE') AS "paymentStatus",
            b."paymentConfirmedAt",
            b."confirmationToken",
            b."confirmationTokenHash",
            b."confirmationTokenExpiresAt",
            b."confirmationTokenUsedAt",
            b."createdBy"::text AS "createdBy",
            b."createdAt",
            ${seriesColumns}
            br.name AS "barberName",
            br."avatarUrl" AS "barberAvatarUrl",
            br."isActive" AS "barberIsActive",
            s.name AS "serviceName",
            s."durationMinutes" AS "serviceDurationMinutes",
            s."isProcedure" AS "serviceIsProcedure",
            s."priceCents" AS "servicePriceCents",
            s."isActive" AS "serviceIsActive"
          FROM "Booking" b
          INNER JOIN "Barber" br ON br.id = b."barberId"
          INNER JOIN "Service" s ON s.id = b."serviceId"
          WHERE b."confirmationTokenHash" = ${tokenHash}
             OR b."confirmationToken" = ${token}
          LIMIT 1
        `
      : await prisma.$queryRaw<BookingWithRelationsRow[]>`
          SELECT
            b.id,
            b."barberId",
            b."serviceId",
            NULL::text AS "clientId",
            b."customerName",
            b."customerPhone",
            NULL::text AS "observations",
            b."dateTimeStart",
            b."dateTimeEnd",
            b.status::text AS status,
            'PENDENTE' AS "paymentStatus",
            NULL::timestamp AS "paymentConfirmedAt",
            NULL::text AS "confirmationToken",
            NULL::text AS "confirmationTokenHash",
            NULL::timestamp AS "confirmationTokenExpiresAt",
            NULL::timestamp AS "confirmationTokenUsedAt",
            'CLIENT' AS "createdBy",
            b."createdAt",
            ${seriesColumns}
            br.name AS "barberName",
            br."avatarUrl" AS "barberAvatarUrl",
            br."isActive" AS "barberIsActive",
            s.name AS "serviceName",
            s."durationMinutes" AS "serviceDurationMinutes",
            s."isProcedure" AS "serviceIsProcedure",
            s."priceCents" AS "servicePriceCents",
            s."isActive" AS "serviceIsActive"
          FROM "Booking" b
          INNER JOIN "Barber" br ON br.id = b."barberId"
          INNER JOIN "Service" s ON s.id = b."serviceId"
          WHERE 1 = 0
          LIMIT 1
        `;

    const row = rows[0];
    return row ? toBookingWithRelations(row) : undefined;
  },

  async listBookings(filters) {
    const hasPaymentColumns = await ensureBookingPaymentColumnsExist();
    const seriesColumns = bookingSeriesColumnsSql(await ensureBookingSeriesColumnsExist());
    const barberFilter = filters?.barberId ? Prisma.sql`AND b."barberId" = ${filters.barberId}` : Prisma.empty;
    const clientFilter = filters?.clientId ? Prisma.sql`AND b."clientId" = ${filters.clientId}` : Prisma.empty;
    const statusFilter =
      filters?.status && filters.status !== "TODOS"
        ? Prisma.sql`AND b.status::text = ${filters.status}`
        : Prisma.empty;
    const dayRange = filters?.date ? getDayRangeIso(filters.date, BUSINESS_CONFIG.timezone) : null;
    const dateFilter = dayRange
      ? Prisma.sql`AND b."dateTimeStart" >= ${new Date(dayRange.start)} AND b."dateTimeStart" <= ${new Date(dayRange.end)}`
      : Prisma.empty;

    const rows = hasPaymentColumns
      ? await prisma.$queryRaw<BookingWithRelationsRow[]>`
          SELECT
            b.id,
            b."barberId",
            b."serviceId",
            b."clientId",
            b."customerName",
            b."customerPhone",
            b."observations",
            b."dateTimeStart",
            b."dateTimeEnd",
            b.status::text AS status,
            COALESCE(b."paymentStatus"::text, 'PENDENTE') AS "paymentStatus",
            b."paymentConfirmedAt",
            b."confirmationToken",
            b."confirmationTokenHash",
            b."confirmationTokenExpiresAt",
            b."confirmationTokenUsedAt",
            b."createdBy"::text AS "createdBy",
            b."createdAt",
            ${seriesColumns}
            br.name AS "barberName",
            br."avatarUrl" AS "barberAvatarUrl",
            br."isActive" AS "barberIsActive",
            s.name AS "serviceName",
            s."durationMinutes" AS "serviceDurationMinutes",
            s."isProcedure" AS "serviceIsProcedure",
            s."priceCents" AS "servicePriceCents",
            s."isActive" AS "serviceIsActive"
          FROM "Booking" b
          INNER JOIN "Barber" br ON br.id = b."barberId"
          INNER JOIN "Service" s ON s.id = b."serviceId"
          WHERE 1 = 1
          ${barberFilter}
          ${clientFilter}
          ${statusFilter}
          ${dateFilter}
          ORDER BY b."dateTimeStart" ASC
        `
      : await prisma.$queryRaw<BookingWithRelationsRow[]>`
          SELECT
            b.id,
            b."barberId",
            b."serviceId",
            NULL::text AS "clientId",
            b."customerName",
            b."customerPhone",
            NULL::text AS "observations",
            b."dateTimeStart",
            b."dateTimeEnd",
            b.status::text AS status,
            'PENDENTE' AS "paymentStatus",
            NULL::timestamp AS "paymentConfirmedAt",
            NULL::text AS "confirmationToken",
            NULL::text AS "confirmationTokenHash",
            NULL::timestamp AS "confirmationTokenExpiresAt",
            NULL::timestamp AS "confirmationTokenUsedAt",
            'CLIENT' AS "createdBy",
            b."createdAt",
            ${seriesColumns}
            br.name AS "barberName",
            br."avatarUrl" AS "barberAvatarUrl",
            br."isActive" AS "barberIsActive",
            s.name AS "serviceName",
            s."durationMinutes" AS "serviceDurationMinutes",
            s."isProcedure" AS "serviceIsProcedure",
            s."priceCents" AS "servicePriceCents",
            s."isActive" AS "serviceIsActive"
          FROM "Booking" b
          INNER JOIN "Barber" br ON br.id = b."barberId"
          INNER JOIN "Service" s ON s.id = b."serviceId"
          WHERE 1 = 1
          ${barberFilter}
          ${clientFilter}
          ${statusFilter}
          ${dateFilter}
          ORDER BY b."dateTimeStart" ASC
        `;

    return rows.map(toBookingWithRelations);
  },

  async listBlockedSlots(date) {
    const dayRange = date ? getDayRangeIso(date, BUSINESS_CONFIG.timezone) : null;
    const rows = await prisma.blockedSlot.findMany({
      where: dayRange
        ? {
          dateTimeStart: { lt: new Date(dayRange.end) },
          dateTimeEnd: { gt: new Date(dayRange.start) },
        }
        : undefined,
      orderBy: { dateTimeStart: "asc" },
    });

    return rows.map(toBlockedSlot);
  },

  async listBookingsInRange(startIso, endIso, barberId) {
    const rows = await prisma.booking.findMany({
      where: {
        ...(barberId ? { barberId } : {}),
        status: { not: "CANCELADO" },
        dateTimeStart: { lt: new Date(endIso) },
        dateTimeEnd: { gt: new Date(startIso) },
      },
      orderBy: { dateTimeStart: "asc" },
    });

    return rows.map(toBooking);
  },

  async createBooking(input: CreateBookingInput) {
    try {
      const created = await prisma.$transaction(
        async (tx) => {
        const conflict = await tx.booking.findFirst({
          where: {
            barberId: input.barberId,
            status: { not: "CANCELADO" },
            dateTimeStart: { lt: new Date(input.dateTimeEnd) },
            dateTimeEnd: { gt: new Date(input.dateTimeStart) },
          },
        });

        if (conflict) {
          throw new Error("Este horario acabou de ser reservado. Escolha outro horario.");
        }

        return tx.booking.create({
          data: {
            barberId: input.barberId,
            serviceId: input.serviceId,
            clientId: input.clientId,
            customerName: input.customerName,
            customerPhone: input.customerPhone,
            observations: input.observations?.trim() || null,
            dateTimeStart: new Date(input.dateTimeStart),
            dateTimeEnd: new Date(input.dateTimeEnd),
            status: input.status ?? "PENDENTE",
            confirmationToken: input.confirmationToken,
            confirmationTokenHash: input.confirmationTokenHash,
            confirmationTokenExpiresAt: input.confirmationTokenExpiresAt
              ? new Date(input.confirmationTokenExpiresAt)
              : undefined,
            createdBy: input.createdBy ?? "CLIENT",
          },
        });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      return toBooking(created);
    } catch (error) {
      if (isSerializableTransactionConflict(error)) {
        throw new Error("Este horário acabou de ser reservado. Escolha outro horário.");
      }
      throw error;
    }
  },

  async updateBooking(input: UpdateBookingInput) {
    const existing = await prisma.booking.findUnique({
      where: { id: input.bookingId },
    });
    if (!existing) {
      return undefined;
    }

    try {
      const updated = await prisma.$transaction(
        async (tx) => {
        const conflict = await tx.booking.findFirst({
          where: {
            id: { not: input.bookingId },
            barberId: input.barberId,
            status: { not: "CANCELADO" },
            dateTimeStart: { lt: new Date(input.dateTimeEnd) },
            dateTimeEnd: { gt: new Date(input.dateTimeStart) },
          },
        });

        if (conflict) {
          throw new Error("Este horario acabou de ser reservado. Escolha outro horario.");
        }

        return tx.booking.update({
          where: { id: input.bookingId },
          data: {
            barberId: input.barberId,
            serviceId: input.serviceId,
            customerName: input.customerName,
            customerPhone: input.customerPhone,
            observations: input.observations?.trim() || null,
            dateTimeStart: new Date(input.dateTimeStart),
            dateTimeEnd: new Date(input.dateTimeEnd),
          },
        });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      return toBooking(updated);
    } catch (error) {
      if (isSerializableTransactionConflict(error)) {
        throw new Error("Este horário acabou de ser reservado. Escolha outro horário.");
      }
      throw error;
    }
  },

  async updateBookingStatus(bookingId, status) {
    const existing = await prisma.booking.findUnique({
      where: { id: bookingId },
    });
    if (!existing) {
      return undefined;
    }

    const updated = await prisma.booking.update({
      where: { id: bookingId },
      data: { status },
    });

    return toBooking(updated);
  },

  async confirmBookingByToken(token) {
    const now = new Date();
    const tokenHash = sha256(token);
    const updated = await prisma.$transaction(async (tx) => {
      const booking = await tx.booking.findFirst({
        where: {
          OR: [
            { confirmationTokenHash: tokenHash },
            { confirmationToken: token },
          ],
          confirmationTokenUsedAt: null,
          confirmationTokenExpiresAt: { gt: now },
          status: "PENDENTE",
        },
      });

      if (!booking) {
        return undefined;
      }

      return tx.booking.update({
        where: { id: booking.id },
        data: {
          status: "CONFIRMADO",
          confirmationTokenUsedAt: now,
        },
      });
    });

    if (!updated) {
      return undefined;
    }

    return getBookingWithRelationsById(updated.id);
  },

  async updateBookingPaymentStatus(bookingId, paymentStatus) {
    const hasPaymentColumns = await ensureBookingPaymentColumnsExist();
    if (!hasPaymentColumns) {
      throw new Error("Confirmacao de pagamento indisponivel. Execute a migration do banco.");
    }

    const existing = await prisma.booking.findUnique({
      where: { id: bookingId },
    });
    if (!existing) {
      return undefined;
    }

    await prisma.$executeRaw`
      UPDATE "Booking"
      SET
        "paymentStatus" = CAST(${paymentStatus} AS "BookingPaymentStatus"),
        "paymentConfirmedAt" = ${paymentStatus === "CONFIRMADO" ? new Date() : null}
      WHERE id = ${bookingId}
    `;

    const updated = await getBookingWithRelationsById(bookingId);
    return updated ?? undefined;
  },

  async findClientByPhone(phone) {
    const normalized = normalizePhone(phone);
    const client = await prisma.client.findUnique({
      where: { phoneNormalized: normalized },
      select: {
        id: true,
        name: true,
        phone: true,
        hasPassword: true,
        status: true,
        createdBy: true,
        createdAt: true,
      },
    });

    return client ? toClientUser(client) : undefined;
  },

  async upsertPendingClient(input) {
    const normalized = normalizePhone(input.phone);
    const select = {
      id: true, name: true, phone: true, hasPassword: true, status: true,
      createdBy: true, createdAt: true,
    } as const;
    const existing = await prisma.client.findUnique({ where: { phoneNormalized: normalized }, select });
    if (existing) {
      return toClientUser(existing);
    }

    try {
      const client = await prisma.client.create({
        data: {
        name: input.name,
        phone: input.phone,
        phoneNormalized: normalized,
        passwordHash: null,
        hasPassword: false,
        status: "PENDING",
        createdBy: "BARBER",
      },
        select,
      });
      return toClientUser(client);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const raced = await prisma.client.findUnique({ where: { phoneNormalized: normalized }, select });
        if (raced) return toClientUser(raced);
      }
      throw error;
    }
  },

  async createBlockedSlot(input: CreateBlockedSlotInput) {
    const created = await prisma.blockedSlot.create({
      data: {
        barberId: input.barberId ?? null,
        dateTimeStart: new Date(input.dateTimeStart),
        dateTimeEnd: new Date(input.dateTimeEnd),
        reason: input.reason,
      },
    });

    return toBlockedSlot(created);
  },

  async deleteBlockedSlot(blockedSlotId) {
    const result = await prisma.blockedSlot.deleteMany({
      where: { id: blockedSlotId },
    });
    return result.count > 0;
  },

  async listBarberAvailabilities(barberId) {
    const hasTable = await ensureBarberAvailabilityTableExists();
    if (!hasTable) {
      throw new Error("Disponibilidade indisponível. Execute as migrations do banco.");
    }

    const availability = getBarberAvailabilityDelegate();
    if (!availability) {
      throw new Error("Disponibilidade indisponível. Atualize o Prisma Client.");
    }

    try {
      const rows = await availability.findMany({
        where: { barberId },
        orderBy: [{ dayOfWeek: "asc" }, { openTime: "asc" }],
      });

      const savedDays = new Set(rows.map((row) => row.dayOfWeek));
      return [...rows.map(toBarberAvailability), ...defaultAvailabilitiesForMissingDays(barberId, savedDays)].sort(
        (a, b) => a.dayOfWeek - b.dayOfWeek || a.openTime.localeCompare(b.openTime),
      );
    } catch (error) {
      if (isBarberAvailabilityTableMissing(error)) {
        availabilityTableExists = false;
        throw new Error("Disponibilidade indisponível. Execute as migrations do banco.");
      }
      throw error;
    }
  },

  async replaceBarberDayAvailabilities(input) {
    const hasTable = await ensureBarberAvailabilityTableExists();
    if (!hasTable) {
      throw new Error("Disponibilidade indisponivel. Execute a migration do banco (BarberAvailability).");
    }

    const availability = getBarberAvailabilityDelegate();
    if (!availability) {
      throw new Error("Disponibilidade indisponivel. Execute a migration e regenere o Prisma Client.");
    }

    try {
      await prisma.$transaction(async (tx) => {
        const txAvailability = (tx as unknown as {
          barberAvailability?: {
            deleteMany: (args: unknown) => Promise<{ count: number }>;
            createMany: (args: unknown) => Promise<{ count: number }>;
          };
        }).barberAvailability;

        if (!txAvailability) {
          throw new Error("Disponibilidade indisponivel. Execute a migration e regenere o Prisma Client.");
        }

        await txAvailability.deleteMany({
          where: {
            barberId: input.barberId,
            dayOfWeek: input.dayOfWeek,
          },
        });

        await txAvailability.createMany({
          data:
            input.ranges.length > 0
              ? input.ranges.map((range) => ({
                barberId: input.barberId,
                dayOfWeek: input.dayOfWeek,
                openTime: range.openTime,
                closeTime: range.closeTime,
              }))
              : [
                {
                  barberId: input.barberId,
                  dayOfWeek: input.dayOfWeek,
                  openTime: CLOSED_DAY_TIME,
                  closeTime: CLOSED_DAY_TIME,
                },
              ],
        });
      });

      const rows = await availability.findMany({
        where: {
          barberId: input.barberId,
          dayOfWeek: input.dayOfWeek,
        },
        orderBy: { openTime: "asc" },
      });

      return rows.map(toBarberAvailability);
    } catch (error) {
      if (isBarberAvailabilityTableMissing(error)) {
        availabilityTableExists = false;
        throw new Error("Disponibilidade indisponivel. Execute a migration do banco (BarberAvailability).");
      }
      throw error;
    }
  },

  async listGalleryImages() {
    const hasTable = await ensureGalleryTableExists();
    if (!hasTable) {
      throw new Error("Galeria indisponível. Execute as migrations do banco.");
    }

    const gallery = getGalleryDelegate();
    if (!gallery) {
      throw new Error("Galeria indisponível. Atualize o Prisma Client.");
    }

    try {
      const rows = await gallery.findMany({
        orderBy: { createdAt: "desc" },
      });
      return rows.map(toGalleryImage);
    } catch (error) {
      if (isGalleryTableMissing(error)) {
        galleryTableExists = false;
        throw new Error("Galeria indisponível. Execute as migrations do banco.");
      }
      throw error;
    }
  },

  async createGalleryImage(input: CreateGalleryImageInput) {
    const hasTable = await ensureGalleryTableExists();
    if (!hasTable) {
      throw new Error("Galeria indisponível. Execute a migration do banco (GalleryImage).");
    }

    const gallery = getGalleryDelegate();
    if (!gallery) {
      throw new Error("Galeria indisponível. Execute a migration e regenere o Prisma Client.");
    }

    try {
      const created = await gallery.create({
        data: {
          imageUrl: input.imageUrl,
          altText: input.altText ?? null,
          mediaType: input.mediaType ?? "IMAGE",
        },
      });
      return toGalleryImage(created);
    } catch (error) {
      if (isGalleryTableMissing(error)) {
        galleryTableExists = false;
        throw new Error("Galeria indisponível. Execute a migration do banco (GalleryImage).");
      }
      throw error;
    }
  },

  async deleteGalleryImage(galleryImageId) {
    const hasTable = await ensureGalleryTableExists();
    if (!hasTable) {
      throw new Error("Galeria indisponível. Execute a migration do banco (GalleryImage).");
    }

    const gallery = getGalleryDelegate();
    if (!gallery) {
      throw new Error("Galeria indisponível. Execute a migration e regenere o Prisma Client.");
    }

    try {
      const result = await gallery.deleteMany({
        where: { id: galleryImageId },
      });
      return result.count > 0;
    } catch (error) {
      if (isGalleryTableMissing(error)) {
        galleryTableExists = false;
        throw new Error("Galeria indisponível. Execute a migration do banco (GalleryImage).");
      }
      throw error;
    }
  },
};
