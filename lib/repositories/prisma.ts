import { prisma } from "@/lib/prisma";
import { barbersSeed, servicesSeed } from "@/lib/data/seed";
import { Barber, Booking, BookingWithRelations, BlockedSlot, GalleryImage } from "@/types/domain";
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

let defaultsEnsured = false;
let galleryTableChecked = false;
let galleryTableExists = false;

function getGalleryDelegate() {
  return (prisma as unknown as { galleryImage?: {
    findMany: (args: unknown) => Promise<Array<{ id: string; imageUrl: string; altText: string | null; createdAt: Date }>>;
    create: (args: unknown) => Promise<{ id: string; imageUrl: string; altText: string | null; createdAt: Date }>;
    deleteMany: (args: unknown) => Promise<{ count: number }>;
  } }).galleryImage;
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

async function ensureDefaultCatalog() {
  if (defaultsEnsured) {
    return;
  }

  const [servicesCount, barbersCount] = await Promise.all([prisma.service.count(), prisma.barber.count()]);

  if (servicesCount === 0) {
    await prisma.service.createMany({
      data: servicesSeed.map((service) => ({
        id: service.id,
        name: service.name,
        durationMinutes: service.durationMinutes,
        priceCents: service.priceCents,
        isActive: service.isActive,
      })),
      skipDuplicates: true,
    });
  }

  if (barbersCount === 0) {
    await prisma.barber.createMany({
      data: barbersSeed.map((barber) => ({
        id: barber.id,
        name: barber.name,
        avatarUrl: barber.avatarUrl ?? null,
        isActive: barber.isActive,
      })),
      skipDuplicates: true,
    });
  }

  defaultsEnsured = true;
}

export const prismaRepository: BookingRepository = {
  async getServices() {
    await ensureDefaultCatalog();
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
    await ensureDefaultCatalog();
    const rows = await prisma.barber.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
    });
    return rows.map(toBarber);
  },

  async getServiceById(id: string) {
    await ensureDefaultCatalog();
    const service = await prisma.service.findFirst({
      where: { id, isActive: true },
    });
    return service ?? undefined;
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
      throw new Error("Galeria indisponivel. Execute a migration do banco (GalleryImage).");
    }

    const gallery = getGalleryDelegate();
    if (!gallery) {
      throw new Error("Galeria indisponivel. Execute a migration e regenere o Prisma Client.");
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
        throw new Error("Galeria indisponivel. Execute a migration do banco (GalleryImage).");
      }
      throw error;
    }
  },

  async deleteGalleryImage(galleryImageId) {
    const hasTable = await ensureGalleryTableExists();
    if (!hasTable) {
      throw new Error("Galeria indisponivel. Execute a migration do banco (GalleryImage).");
    }

    const gallery = getGalleryDelegate();
    if (!gallery) {
      throw new Error("Galeria indisponivel. Execute a migration e regenere o Prisma Client.");
    }

    try {
      const result = await gallery.deleteMany({
        where: { id: galleryImageId },
      });
      return result.count > 0;
    } catch (error) {
      if (isGalleryTableMissing(error)) {
        galleryTableExists = false;
        throw new Error("Galeria indisponivel. Execute a migration do banco (GalleryImage).");
      }
      throw error;
    }
  },
};
