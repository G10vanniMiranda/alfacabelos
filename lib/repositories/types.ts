import {
  Barber,
  BlockedSlot,
  Booking,
  BookingCreatedBy,
  BookingFilters,
  BookingPaymentStatus,
  BookingStatus,
  BookingWithRelations,
  BarberAvailability,
  ClientUser,
  GalleryImage,
  Service,
} from "@/types/domain";

export type CreateBookingInput = {
  serviceId: string;
  barberId: string;
  clientId?: string;
  customerName: string;
  customerPhone: string;
  observations?: string;
  dateTimeStart: string;
  dateTimeEnd: string;
  status?: BookingStatus;
  confirmationToken?: string;
  confirmationTokenHash?: string;
  confirmationTokenExpiresAt?: string;
  createdBy?: BookingCreatedBy;
};

export type UpdateBookingInput = {
  bookingId: string;
  serviceId: string;
  barberId: string;
  customerName: string;
  customerPhone: string;
  observations?: string;
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
  mediaType?: "IMAGE" | "VIDEO";
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
  createService(data: { name: string; priceCents: number; durationMinutes: number; isProcedure: boolean }): Promise<Service>;
  updateService(serviceId: string, data: { name: string; priceCents: number; durationMinutes: number; isProcedure: boolean }): Promise<Service | undefined>;
  deleteService(serviceId: string): Promise<boolean>;
  getBarbers(): Promise<Barber[]>;
  getServiceById(id: string): Promise<Service | undefined>;
  getBookingById(id: string): Promise<BookingWithRelations | undefined>;
  getBookingByConfirmationToken(token: string): Promise<BookingWithRelations | undefined>;
  listBookings(filters?: BookingFilters): Promise<BookingWithRelations[]>;
  listBlockedSlots(date?: string): Promise<BlockedSlot[]>;
  listBookingsInRange(startIso: string, endIso: string, barberId?: string): Promise<Booking[]>;
  createBooking(input: CreateBookingInput): Promise<Booking>;
  updateBooking(input: UpdateBookingInput): Promise<Booking | undefined>;
  updateBookingStatus(bookingId: string, status: BookingStatus): Promise<Booking | undefined>;
  confirmBookingByToken(token: string): Promise<BookingWithRelations | undefined>;
  updateBookingPaymentStatus(bookingId: string, paymentStatus: BookingPaymentStatus): Promise<Booking | undefined>;
  findClientByPhone(phone: string): Promise<ClientUser | undefined>;
  upsertPendingClient(input: { name: string; phone: string }): Promise<ClientUser>;
  createBlockedSlot(input: CreateBlockedSlotInput): Promise<BlockedSlot>;
  deleteBlockedSlot(blockedSlotId: string): Promise<boolean>;
  listBarberAvailabilities(barberId: string): Promise<BarberAvailability[]>;
  replaceBarberDayAvailabilities(input: UpsertBarberAvailabilityInput): Promise<BarberAvailability[]>;
  listGalleryImages(): Promise<GalleryImage[]>;
  createGalleryImage(input: CreateGalleryImageInput): Promise<GalleryImage>;
  deleteGalleryImage(galleryImageId: string): Promise<boolean>;
}

