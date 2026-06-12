export type BookingStatus = "PENDENTE" | "CONFIRMADO" | "CANCELADO";
export type BookingPaymentStatus = "PENDENTE" | "CONFIRMADO";
export type ClientStatus = "PENDING" | "ACTIVE";
export type ClientCreatedBy = "BARBER" | "CLIENT";
export type BookingCreatedBy = "BARBER" | "CLIENT";

export type Barber = {
  id: string;
  name: string;
  avatarUrl?: string;
  isActive: boolean;
};

export type Service = {
  id: string;
  name: string;
  durationMinutes: number;
  priceCents: number;
  isActive: boolean;
};

export type Booking = {
  id: string;
  barberId: string;
  serviceId: string;
  clientId?: string;
  customerName: string;
  customerPhone: string;
  observations?: string;
  dateTimeStart: string;
  dateTimeEnd: string;
  status: BookingStatus;
  paymentStatus: BookingPaymentStatus;
  paymentConfirmedAt?: string;
  confirmationToken?: string;
  confirmationTokenHash?: string;
  confirmationTokenExpiresAt?: string;
  confirmationTokenUsedAt?: string;
  createdBy: BookingCreatedBy;
  createdAt: string;
};

export type BlockedSlot = {
  id: string;
  barberId?: string;
  dateTimeStart: string;
  dateTimeEnd: string;
  reason: string;
  createdAt: string;
};

export type BarberAvailability = {
  id: string;
  barberId: string;
  dayOfWeek: number;
  openTime: string;
  closeTime: string;
  createdAt: string;
  updatedAt: string;
};

export type ClientUser = {
  id: string;
  name: string;
  phone: string;
  hasPassword: boolean;
  status: ClientStatus;
  createdBy: ClientCreatedBy;
  createdAt: string;
};

export type AdminAccessUser = {
  id: string;
  email: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
};

export type GalleryImage = {
  id: string;
  imageUrl: string;
  altText?: string;
  mediaType?: "IMAGE" | "VIDEO";
  createdAt: string;
};

export type BookingWithRelations = Booking & {
  barber: Barber;
  service: Service;
};

export type DailyOperatingConfig = {
  dayOfWeek: number;
  open: string;
  close: string;
};

export type BookingFilters = {
  date?: string;
  barberId?: string;
  status?: BookingStatus | "TODOS";
};
