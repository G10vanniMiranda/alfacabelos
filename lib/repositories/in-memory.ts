import { barbersSeed, servicesSeed } from "@/lib/data/seed";
import { BUSINESS_CONFIG } from "@/lib/config";
import { CLOSED_DAY_TIME } from "@/lib/constants/availability";
import { getLocalDateInput, overlaps } from "@/lib/utils";
import {
  Barber,
  BarberAvailability,
  BlockedSlot,
  Booking,
  BookingFilters,
  BookingPaymentStatus,
  BookingStatus,
  BookingWithRelations,
  GalleryImage,
  Service,
} from "@/types/domain";
import { BookingRepository, CreateBlockedSlotInput, CreateBookingInput, CreateGalleryImageInput, UpdateBookingInput } from "./types";

const data = {
  barbers: [...barbersSeed] as Barber[],
  services: [...servicesSeed] as Service[],
  bookings: [] as Booking[],
  blockedSlots: [] as BlockedSlot[],
  availabilities: [] as BarberAvailability[],
  galleryImages: [] as GalleryImage[],
};

function withRelations(booking: Booking): BookingWithRelations {
  const barber = data.barbers.find((item) => item.id === booking.barberId);
  const service = data.services.find((item) => item.id === booking.serviceId);

  if (!barber || !service) {
    throw new Error("Relacionamentos inválidos no agendamento");
  }

  return { ...booking, barber, service };
}

function createId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function defaultAvailabilitiesForMissingDays(barberId: string, savedDays: Set<number>): BarberAvailability[] {
  const now = new Date().toISOString();
  return BUSINESS_CONFIG.operatingHours
    .filter((slot) => !savedDays.has(slot.dayOfWeek))
    .map((slot) => ({
      id: `default-${barberId}-${slot.dayOfWeek}-${slot.open}-${slot.close}`,
      barberId,
      dayOfWeek: slot.dayOfWeek,
      openTime: slot.open,
      closeTime: slot.close,
      createdAt: now,
      updatedAt: now,
    }));
}

export const inMemoryRepository: BookingRepository = {
  async getServices() {
    return data.services.filter((item) => item.isActive);
  },

  async createService(input) {
    const service: Service = {
      id: createId("service"),
      name: input.name,
      priceCents: input.priceCents,
      durationMinutes: input.durationMinutes,
      isActive: true,
    };

    data.services.push(service);
    return service;
  },

  async updateService(serviceId, input) {
    const service = data.services.find((item) => item.id === serviceId);
    if (!service) {
      return undefined;
    }

    service.name = input.name;
    service.priceCents = input.priceCents;
    return service;
  },

  async deleteService(serviceId) {
    const service = data.services.find((item) => item.id === serviceId);
    if (!service) {
      return false;
    }

    service.isActive = false;
    return true;
  },

  async getBarbers() {
    return data.barbers.filter((item) => item.isActive);
  },

  async getServiceById(id: string) {
    return data.services.find((item) => item.id === id && item.isActive);
  },

  async getBookingById(id: string) {
    const booking = data.bookings.find((item) => item.id === id);
    return booking ? withRelations(booking) : undefined;
  },

  async listBookings(filters?: BookingFilters) {
    const base = data.bookings
      .map(withRelations)
      .sort((a, b) => new Date(a.dateTimeStart).getTime() - new Date(b.dateTimeStart).getTime());

    return base.filter((booking) => {
      if (filters?.barberId && booking.barberId !== filters.barberId) {
        return false;
      }
      if (filters?.status && filters.status !== "TODOS" && booking.status !== filters.status) {
        return false;
      }
      if (filters?.date) {
        const bookingDate = getLocalDateInput(booking.dateTimeStart);
        return bookingDate === filters.date;
      }
      return true;
    });
  },

  async listBlockedSlots(date?: string) {
    const base = [...data.blockedSlots].sort(
      (a, b) => new Date(a.dateTimeStart).getTime() - new Date(b.dateTimeStart).getTime(),
    );

    if (!date) {
      return base;
    }

    return base.filter((slot) => getLocalDateInput(slot.dateTimeStart, BUSINESS_CONFIG.timezone) === date);
  },

  async listBookingsInRange(startIso: string, endIso: string, barberId?: string) {
    const rangeStart = new Date(startIso);
    const rangeEnd = new Date(endIso);

    return data.bookings.filter((booking) => {
      if (barberId && booking.barberId !== barberId) {
        return false;
      }
      if (booking.status === "CANCELADO") {
        return false;
      }
      return overlaps(rangeStart, rangeEnd, new Date(booking.dateTimeStart), new Date(booking.dateTimeEnd));
    });
  },

  async createBooking(input: CreateBookingInput) {
    const hasConflict = data.bookings.some((booking) => {
      if (booking.barberId !== input.barberId || booking.status === "CANCELADO") {
        return false;
      }

      return overlaps(
        new Date(input.dateTimeStart),
        new Date(input.dateTimeEnd),
        new Date(booking.dateTimeStart),
        new Date(booking.dateTimeEnd),
      );
    });

    if (hasConflict) {
      throw new Error("Este horario acabou de ser reservado. Escolha outro horario.");
    }

    const booking: Booking = {
      id: createId("booking"),
      barberId: input.barberId,
      serviceId: input.serviceId,
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      dateTimeStart: input.dateTimeStart,
      dateTimeEnd: input.dateTimeEnd,
      status: "PENDENTE",
      paymentStatus: "PENDENTE",
      createdAt: new Date().toISOString(),
    };

    data.bookings.push(booking);
    return booking;
  },

  async updateBooking(input: UpdateBookingInput) {
    const booking = data.bookings.find((item) => item.id === input.bookingId);
    if (!booking) {
      return undefined;
    }

    const hasConflict = data.bookings.some((item) => {
      if (item.id === input.bookingId || item.barberId !== input.barberId || item.status === "CANCELADO") {
        return false;
      }

      return overlaps(
        new Date(input.dateTimeStart),
        new Date(input.dateTimeEnd),
        new Date(item.dateTimeStart),
        new Date(item.dateTimeEnd),
      );
    });

    if (hasConflict) {
      throw new Error("Este horario acabou de ser reservado. Escolha outro horario.");
    }

    booking.barberId = input.barberId;
    booking.serviceId = input.serviceId;
    booking.customerName = input.customerName;
    booking.customerPhone = input.customerPhone;
    booking.dateTimeStart = input.dateTimeStart;
    booking.dateTimeEnd = input.dateTimeEnd;
    return booking;
  },

  async updateBookingStatus(bookingId: string, status: BookingStatus) {
    const booking = data.bookings.find((item) => item.id === bookingId);
    if (!booking) {
      return undefined;
    }
    booking.status = status;
    return booking;
  },

  async updateBookingPaymentStatus(bookingId: string, paymentStatus: BookingPaymentStatus) {
    const booking = data.bookings.find((item) => item.id === bookingId);
    if (!booking) {
      return undefined;
    }
    booking.paymentStatus = paymentStatus;
    booking.paymentConfirmedAt = paymentStatus === "CONFIRMADO" ? new Date().toISOString() : undefined;
    return booking;
  },

  async createBlockedSlot(input: CreateBlockedSlotInput) {
    const blocked: BlockedSlot = {
      id: createId("blocked"),
      barberId: input.barberId,
      dateTimeStart: input.dateTimeStart,
      dateTimeEnd: input.dateTimeEnd,
      reason: input.reason,
      createdAt: new Date().toISOString(),
    };

    data.blockedSlots.push(blocked);
    return blocked;
  },

  async deleteBlockedSlot(blockedSlotId: string) {
    const index = data.blockedSlots.findIndex((item) => item.id === blockedSlotId);
    if (index < 0) {
      return false;
    }
    data.blockedSlots.splice(index, 1);
    return true;
  },

  async listBarberAvailabilities(barberId: string) {
    const saved = data.availabilities
      .filter((item) => item.barberId === barberId)
      .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.openTime.localeCompare(b.openTime));
    const savedDays = new Set(saved.map((item) => item.dayOfWeek));
    return [...saved, ...defaultAvailabilitiesForMissingDays(barberId, savedDays)].sort(
      (a, b) => a.dayOfWeek - b.dayOfWeek || a.openTime.localeCompare(b.openTime),
    );
  },

  async replaceBarberDayAvailabilities(input) {
    const now = new Date().toISOString();
    const remaining = data.availabilities.filter(
      (item) => !(item.barberId === input.barberId && item.dayOfWeek === input.dayOfWeek),
    );

    const created =
      input.ranges.length > 0
        ? input.ranges.map((range) => ({
          id: createId("availability"),
          barberId: input.barberId,
          dayOfWeek: input.dayOfWeek,
          openTime: range.openTime,
          closeTime: range.closeTime,
          createdAt: now,
          updatedAt: now,
        }))
        : [
          {
            id: createId("availability"),
            barberId: input.barberId,
            dayOfWeek: input.dayOfWeek,
            openTime: CLOSED_DAY_TIME,
            closeTime: CLOSED_DAY_TIME,
            createdAt: now,
            updatedAt: now,
          },
        ];

    data.availabilities = [...remaining, ...created];
    return created;
  },

  async listGalleryImages() {
    return [...data.galleryImages].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },

  async createGalleryImage(input: CreateGalleryImageInput) {
    const image: GalleryImage = {
      id: createId("gallery"),
      imageUrl: input.imageUrl,
      altText: input.altText,
      mediaType: input.mediaType ?? "IMAGE",
      createdAt: new Date().toISOString(),
    };

    data.galleryImages.push(image);
    return image;
  },

  async deleteGalleryImage(galleryImageId: string) {
    const index = data.galleryImages.findIndex((item) => item.id === galleryImageId);
    if (index < 0) {
      return false;
    }

    data.galleryImages.splice(index, 1);
    return true;
  },
};
