import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { barbersSeed, servicesSeed } from "@/lib/data/seed";
import { BUSINESS_CONFIG } from "@/lib/config";
import { Barber, BarberAvailability, Booking, BookingWithRelations, BlockedSlot, GalleryImage } from "@/types/domain";
import { BookingRepository, CreateBlockedSlotInput, CreateBookingInput, CreateGalleryImageInput, UpdateBookingInput } from "./types";

type BookingRow = {
  id: string;
  barberId: string;
  serviceId: string;
  customerName: string;
  customerPhone: string;
  dateTimeStart: Date;
  dateTimeEnd: Date;
  status: "PENDENTE" | "CONFIRMADO" | "CANCELADO";
  paymentStatus?: "PENDENTE" | "CONFIRMADO" | null;
  paymentConfirmedAt?: Date | null;
  createdAt: Date;
};

type BookingWithRelationsRow = BookingRow & {
  barberName: string;
  barberAvatarUrl: string | null;
  barberIsActive: boolean;
  serviceName: string;
  serviceDurationMinutes: number;
  servicePriceCents: number;
  serviceIsActive: boolean;
};

function toBooking(row: BookingRow): Booking {
  return {
    id: row.id,
    barberId: row.barberId,
    serviceId: row.serviceId,
    customerName: row.customerName,
    customerPhone: row.customerPhone,
    dateTimeStart: row.dateTimeStart.toISOString(),
    dateTimeEnd: row.dateTimeEnd.toISOString(),
    status: row.status,
    paymentStatus: row.paymentStatus ?? "PENDENTE",
    paymentConfirmedAt: row.paymentConfirmedAt?.toISOString(),
    createdAt: row.createdAt.toISOString(),
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
  createdAt: Date;
}): GalleryImage {
  return {
    id: row.id,
    imageUrl: row.imageUrl,
    altText: row.altText ?? undefined,
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

let galleryTableChecked = false;
let galleryTableExists = false;
let availabilityTableChecked = false;
let availabilityTableExists = false;
let bookingPaymentColumnsChecked = false;
let bookingPaymentColumnsExist = false;

function isDatabaseUnavailableError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const maybe = error as { code?: string; message?: string };
  if (maybe.code === "P1001") {
    return true;
  }

  return typeof maybe.message === "string" && maybe.message.includes("Can't reach database server");
}

function canUseReadFallback() {
  return process.env.NODE_ENV !== "production";
}

async function readWithFallback<T>(action: () => Promise<T>, fallback: () => T | Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (canUseReadFallback() && isDatabaseUnavailableError(error)) {
      return fallback();
    }
    throw error;
  }
}

function getGalleryDelegate() {
  return (prisma as unknown as {
    galleryImage?: {
      findMany: (args: unknown) => Promise<Array<{ id: string; imageUrl: string; altText: string | null; createdAt: Date }>>;
      create: (args: unknown) => Promise<{ id: string; imageUrl: string; altText: string | null; createdAt: Date }>;
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
  } catch {
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
  } catch {
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
    const result = await prisma.$queryRaw<Array<{ exists: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'Booking'
          AND column_name = 'paymentStatus'
      ) AS "exists"
    `;
    bookingPaymentColumnsExist = result[0]?.exists === true;
  } catch {
    bookingPaymentColumnsExist = false;
  } finally {
    bookingPaymentColumnsChecked = true;
  }

  return bookingPaymentColumnsExist;
}

async function getBookingWithRelationsById(id: string): Promise<BookingWithRelations | undefined> {
  const hasPaymentColumns = await ensureBookingPaymentColumnsExist();
  const rows = hasPaymentColumns
    ? await prisma.$queryRaw<BookingWithRelationsRow[]>`
        SELECT
          b.id,
          b."barberId",
          b."serviceId",
          b."customerName",
          b."customerPhone",
          b."dateTimeStart",
          b."dateTimeEnd",
          b.status::text AS status,
          COALESCE(b."paymentStatus"::text, 'PENDENTE') AS "paymentStatus",
          b."paymentConfirmedAt",
          b."createdAt",
          br.name AS "barberName",
          br."avatarUrl" AS "barberAvatarUrl",
          br."isActive" AS "barberIsActive",
          s.name AS "serviceName",
          s."durationMinutes" AS "serviceDurationMinutes",
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
          b."customerName",
          b."customerPhone",
          b."dateTimeStart",
          b."dateTimeEnd",
          b.status::text AS status,
          'PENDENTE' AS "paymentStatus",
          NULL::timestamp AS "paymentConfirmedAt",
          b."createdAt",
          br.name AS "barberName",
          br."avatarUrl" AS "barberAvatarUrl",
          br."isActive" AS "barberIsActive",
          s.name AS "serviceName",
          s."durationMinutes" AS "serviceDurationMinutes",
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
    return readWithFallback(async () => {
      const rows = await prisma.service.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
      });
      if (rows.length > 0) {
        return rows;
      }

      return servicesSeed.filter((service) => service.isActive);
    }, () => servicesSeed.filter((service) => service.isActive));
  },

  async createService(input) {
    return prisma.service.create({
      data: {
        name: input.name,
        priceCents: input.priceCents,
        durationMinutes: input.durationMinutes,
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
    return readWithFallback(async () => {
      let rows = await prisma.barber.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
      });

      if (rows.length === 0) {
        rows = barbersSeed
          .filter((barber) => barber.isActive)
          .map((barber) => ({
            id: barber.id,
            name: barber.name,
            avatarUrl: barber.avatarUrl ?? null,
            isActive: barber.isActive,
          }));
      }

      return rows.map(toBarber);
    }, () => barbersSeed.filter((barber) => barber.isActive));
  },

  async getServiceById(id: string) {
    return readWithFallback(async () => {
      const service = await prisma.service.findFirst({
        where: { id, isActive: true },
      });
      if (service) {
        return service;
      }

      const fallback = servicesSeed.find((item) => item.id === id && item.isActive);
      return fallback ?? undefined;
    }, () => servicesSeed.find((item) => item.id === id && item.isActive));
  },

  async getBookingById(id: string) {
    return getBookingWithRelationsById(id);
  },

  async listBookings(filters) {
    const hasPaymentColumns = await ensureBookingPaymentColumnsExist();
    const barberFilter = filters?.barberId ? Prisma.sql`AND b."barberId" = ${filters.barberId}` : Prisma.empty;
    const statusFilter =
      filters?.status && filters.status !== "TODOS"
        ? Prisma.sql`AND b.status::text = ${filters.status}`
        : Prisma.empty;
    const dateFilter = filters?.date
      ? Prisma.sql`AND b."dateTimeStart" >= ${new Date(`${filters.date}T00:00:00`)} AND b."dateTimeStart" <= ${new Date(
        `${filters.date}T23:59:59.999`,
      )}`
      : Prisma.empty;

    const rows = hasPaymentColumns
      ? await prisma.$queryRaw<BookingWithRelationsRow[]>`
          SELECT
            b.id,
            b."barberId",
            b."serviceId",
            b."customerName",
            b."customerPhone",
            b."dateTimeStart",
            b."dateTimeEnd",
            b.status::text AS status,
            COALESCE(b."paymentStatus"::text, 'PENDENTE') AS "paymentStatus",
            b."paymentConfirmedAt",
            b."createdAt",
            br.name AS "barberName",
            br."avatarUrl" AS "barberAvatarUrl",
            br."isActive" AS "barberIsActive",
            s.name AS "serviceName",
            s."durationMinutes" AS "serviceDurationMinutes",
            s."priceCents" AS "servicePriceCents",
            s."isActive" AS "serviceIsActive"
          FROM "Booking" b
          INNER JOIN "Barber" br ON br.id = b."barberId"
          INNER JOIN "Service" s ON s.id = b."serviceId"
          WHERE 1 = 1
          ${barberFilter}
          ${statusFilter}
          ${dateFilter}
          ORDER BY b."dateTimeStart" ASC
        `
      : await prisma.$queryRaw<BookingWithRelationsRow[]>`
          SELECT
            b.id,
            b."barberId",
            b."serviceId",
            b."customerName",
            b."customerPhone",
            b."dateTimeStart",
            b."dateTimeEnd",
            b.status::text AS status,
            'PENDENTE' AS "paymentStatus",
            NULL::timestamp AS "paymentConfirmedAt",
            b."createdAt",
            br.name AS "barberName",
            br."avatarUrl" AS "barberAvatarUrl",
            br."isActive" AS "barberIsActive",
            s.name AS "serviceName",
            s."durationMinutes" AS "serviceDurationMinutes",
            s."priceCents" AS "servicePriceCents",
            s."isActive" AS "serviceIsActive"
          FROM "Booking" b
          INNER JOIN "Barber" br ON br.id = b."barberId"
          INNER JOIN "Service" s ON s.id = b."serviceId"
          WHERE 1 = 1
          ${barberFilter}
          ${statusFilter}
          ${dateFilter}
          ORDER BY b."dateTimeStart" ASC
        `;

    return rows.map(toBookingWithRelations);
  },

  async listBlockedSlots(date) {
    const rows = await prisma.blockedSlot.findMany({
      where: date
        ? {
          dateTimeStart: {
            gte: new Date(`${date}T00:00:00`),
            lte: new Date(`${date}T23:59:59.999`),
          },
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
            customerName: input.customerName,
            customerPhone: input.customerPhone,
            dateTimeStart: new Date(input.dateTimeStart),
            dateTimeEnd: new Date(input.dateTimeEnd),
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return toBooking(created);
  },

  async updateBooking(input: UpdateBookingInput) {
    const existing = await prisma.booking.findUnique({
      where: { id: input.bookingId },
    });
    if (!existing) {
      return undefined;
    }

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
            dateTimeStart: new Date(input.dateTimeStart),
            dateTimeEnd: new Date(input.dateTimeEnd),
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return toBooking(updated);
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
    const fallbackAvailabilities = () =>
      BUSINESS_CONFIG.operatingHours.map((slot) => ({
        id: `default-${barberId}-${slot.dayOfWeek}-${slot.open}-${slot.close}`,
        barberId,
        dayOfWeek: slot.dayOfWeek,
        openTime: slot.open,
        closeTime: slot.close,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }));

    return readWithFallback(async () => {
      const hasTable = await ensureBarberAvailabilityTableExists();
      if (!hasTable) {
        return fallbackAvailabilities();
      }

      const availability = getBarberAvailabilityDelegate();
      if (!availability) {
        return fallbackAvailabilities();
      }

      try {
        const rows = await availability.findMany({
          where: { barberId },
          orderBy: [{ dayOfWeek: "asc" }, { openTime: "asc" }],
        });

        if (rows.length > 0) {
          return rows.map(toBarberAvailability);
        }

        return fallbackAvailabilities();
      } catch (error) {
        if (isBarberAvailabilityTableMissing(error)) {
          availabilityTableExists = false;
          return fallbackAvailabilities();
        }
        throw error;
      }
    }, fallbackAvailabilities);
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

        if (input.ranges.length > 0) {
          await txAvailability.createMany({
            data: input.ranges.map((range) => ({
              barberId: input.barberId,
              dayOfWeek: input.dayOfWeek,
              openTime: range.openTime,
              closeTime: range.closeTime,
            })),
          });
        }
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
    return readWithFallback(async () => {
      const hasTable = await ensureGalleryTableExists();
      if (!hasTable) {
        return [];
      }

      const gallery = getGalleryDelegate();
      if (!gallery) {
        return [];
      }

      try {
        const rows = await gallery.findMany({
          orderBy: { createdAt: "desc" },
        });
        return rows.map(toGalleryImage);
      } catch (error) {
        if (isGalleryTableMissing(error)) {
          galleryTableExists = false;
          return [];
        }
        throw error;
      }
    }, () => []);
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
