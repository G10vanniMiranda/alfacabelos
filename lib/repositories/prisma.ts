import { prisma } from "@/lib/prisma";
import { Barber, Booking, BookingWithRelations, BlockedSlot } from "@/types/domain";
import { BookingRepository, CreateBlockedSlotInput, CreateBookingInput } from "./types";

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

export const prismaRepository: BookingRepository = {
  async getServices() {
    return prisma.service.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
    });
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
};
