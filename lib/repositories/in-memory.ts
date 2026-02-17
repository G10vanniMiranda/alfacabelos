import { barbersSeed, servicesSeed } from "@/lib/data/seed";
import { overlaps } from "@/lib/utils";
import { Barber, BlockedSlot, Booking, BookingFilters, BookingStatus, BookingWithRelations, GalleryImage, Service } from "@/types/domain";
import { BookingRepository, CreateBlockedSlotInput, CreateBookingInput, CreateGalleryImageInput } from "./types";

const data = {
  barbers: [...barbersSeed] as Barber[],
  services: [...servicesSeed] as Service[],
  bookings: [] as Booking[],
  blockedSlots: [] as BlockedSlot[],
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
        const bookingDate = booking.dateTimeStart.slice(0, 10);
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

    return base.filter((slot) => slot.dateTimeStart.startsWith(date));
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
    const booking: Booking = {
      id: createId("booking"),
      barberId: input.barberId,
      serviceId: input.serviceId,
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      dateTimeStart: input.dateTimeStart,
      dateTimeEnd: input.dateTimeEnd,
      status: "PENDENTE",
      createdAt: new Date().toISOString(),
    };

    data.bookings.push(booking);
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

  async listGalleryImages() {
    return [...data.galleryImages].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },

  async createGalleryImage(input: CreateGalleryImageInput) {
    const image: GalleryImage = {
      id: createId("gallery"),
      imageUrl: input.imageUrl,
      altText: input.altText,
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
