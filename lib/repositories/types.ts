import {
  Barber,
  BlockedSlot,
  Booking,
  BookingFilters,
  BookingStatus,
  BookingWithRelations,
  BarberAvailability,
  GalleryImage,
  Service,
} from "@/types/domain";

export type CreateBookingInput = {
  serviceId: string;
  barberId: string;
  customerName: string;
  customerPhone: string;
  dateTimeStart: string;
  dateTimeEnd: string;
};

export type CreateBlockedSlotInput = {
  barberId?: string;
  dateTimeStart: string;
  dateTimeEnd: string;
  reason: string;
};

export type CreateGalleryImageInput = {
  imageUrl: string;
  altText?: string;
};

export type UpsertBarberAvailabilityInput = {
  barberId: string;
  dayOfWeek: number;
  ranges: Array<{
    openTime: string;
    closeTime: string;
  }>;
};

export interface BookingRepository {
  getServices(): Promise<Service[]>;
  createService(data: { name: string; priceCents: number; durationMinutes: number }): Promise<Service>;
  updateService(serviceId: string, data: { name: string; priceCents: number }): Promise<Service | undefined>;
  deleteService(serviceId: string): Promise<boolean>;
  getBarbers(): Promise<Barber[]>;
  getServiceById(id: string): Promise<Service | undefined>;
  getBookingById(id: string): Promise<BookingWithRelations | undefined>;
  listBookings(filters?: BookingFilters): Promise<BookingWithRelations[]>;
  listBlockedSlots(date?: string): Promise<BlockedSlot[]>;
  listBookingsInRange(startIso: string, endIso: string, barberId?: string): Promise<Booking[]>;
  createBooking(input: CreateBookingInput): Promise<Booking>;
  updateBookingStatus(bookingId: string, status: BookingStatus): Promise<Booking | undefined>;
  createBlockedSlot(input: CreateBlockedSlotInput): Promise<BlockedSlot>;
  deleteBlockedSlot(blockedSlotId: string): Promise<boolean>;
  listBarberAvailabilities(barberId: string): Promise<BarberAvailability[]>;
  replaceBarberDayAvailabilities(input: UpsertBarberAvailabilityInput): Promise<BarberAvailability[]>;
  listGalleryImages(): Promise<GalleryImage[]>;
  createGalleryImage(input: CreateGalleryImageInput): Promise<GalleryImage>;
  deleteGalleryImage(galleryImageId: string): Promise<boolean>;
}

