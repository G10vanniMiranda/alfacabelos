import { prisma } from "@/lib/prisma";
import { barbersSeed, servicesSeed } from "@/lib/data/seed";
import { BUSINESS_CONFIG } from "@/lib/config";
import { Barber, BarberAvailability, Booking, BookingWithRelations, BlockedSlot, GalleryImage } from "@/types/domain";
import { BookingRepository, CreateBlockedSlotInput, CreateBookingInput, CreateGalleryImageInput } from "./types";

function toBooking(row: {
  id: string;
  barberId: string;
  serviceId: string;
  customerName: string;
  customerPhone: string;
  dateTimeStart: Date;
  dateTimeEnd: Date;
  status: "PENDENTE" | "CONFIRMADO" | "CANCELADO";
  createdAt: Date;
}): Booking {
  return {
    id: row.id,
    barberId: row.barberId,
    serviceId: row.serviceId,
    customerName: row.customerName,
    customerPhone: row.customerPhone,
    dateTimeStart: row.dateTimeStart.toISOString(),
    dateTimeEnd: row.dateTimeEnd.toISOString(),
    status: row.status,
    createdAt: row.createdAt.toISOString(),
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

export const prismaRepository: BookingRepository = {
  async getServices() {
    const rows = await prisma.service.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
    });
    if (rows.length > 0) {
      return rows;
    }

    return servicesSeed.filter((service) => service.isActive);
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
  },

  async getServiceById(id: string) {
    const service = await prisma.service.findFirst({
      where: { id, isActive: true },
    });
    if (service) {
      return service;
    }

    const fallback = servicesSeed.find((item) => item.id === id && item.isActive);
    return fallback ?? undefined;
  },

  async getBookingById(id: string) {
    const booking = await prisma.booking.findUnique({
      where: { id },
      include: { barber: true, service: true },
    });
    if (!booking) {
      return undefined;
    }

    return {
      ...toBooking(booking),
      barber: toBarber(booking.barber),
      service: booking.service,
    } satisfies BookingWithRelations;
  },

  async listBookings(filters) {
    const where = {
      ...(filters?.barberId ? { barberId: filters.barberId } : {}),
      ...(filters?.status && filters.status !== "TODOS" ? { status: filters.status } : {}),
      ...(filters?.date
        ? {
          dateTimeStart: {
            gte: new Date(`${filters.date}T00:00:00`),
            lte: new Date(`${filters.date}T23:59:59.999`),
          },
        }
        : {}),
    };

    const rows = await prisma.booking.findMany({
      where,
      include: { barber: true, service: true },
      orderBy: { dateTimeStart: "asc" },
    });

    return rows.map(
      (row) =>
        ({
          ...toBooking(row),
          barber: toBarber(row.barber),
          service: row.service,
        }) satisfies BookingWithRelations,
    );
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
    const created = await prisma.booking.create({
      data: {
        barberId: input.barberId,
        serviceId: input.serviceId,
        customerName: input.customerName,
        customerPhone: input.customerPhone,
        dateTimeStart: new Date(input.dateTimeStart),
        dateTimeEnd: new Date(input.dateTimeEnd),
      },
    });

    return toBooking(created);
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
      return BUSINESS_CONFIG.operatingHours.map((slot) => ({
        id: `default-${barberId}-${slot.dayOfWeek}-${slot.open}-${slot.close}`,
        barberId,
        dayOfWeek: slot.dayOfWeek,
        openTime: slot.open,
        closeTime: slot.close,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }));
    }

    const availability = getBarberAvailabilityDelegate();
    if (!availability) {
      return BUSINESS_CONFIG.operatingHours.map((slot) => ({
        id: `default-${barberId}-${slot.dayOfWeek}-${slot.open}-${slot.close}`,
        barberId,
        dayOfWeek: slot.dayOfWeek,
        openTime: slot.open,
        closeTime: slot.close,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }));
    }

    try {
      const rows = await availability.findMany({
        where: { barberId },
        orderBy: [{ dayOfWeek: "asc" }, { openTime: "asc" }],
      });

      if (rows.length > 0) {
        return rows.map(toBarberAvailability);
      }

      return BUSINESS_CONFIG.operatingHours.map((slot) => ({
        id: `default-${barberId}-${slot.dayOfWeek}-${slot.open}-${slot.close}`,
        barberId,
        dayOfWeek: slot.dayOfWeek,
        openTime: slot.open,
        closeTime: slot.close,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }));
    } catch (error) {
      if (isBarberAvailabilityTableMissing(error)) {
        availabilityTableExists = false;
        return BUSINESS_CONFIG.operatingHours.map((slot) => ({
          id: `default-${barberId}-${slot.dayOfWeek}-${slot.open}-${slot.close}`,
          barberId,
          dayOfWeek: slot.dayOfWeek,
          openTime: slot.open,
          closeTime: slot.close,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }));
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
