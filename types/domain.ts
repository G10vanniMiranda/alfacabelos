export type BookingStatus = "PENDENTE" | "CONFIRMADO" | "CANCELADO";

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
  customerName: string;
  customerPhone: string;
  dateTimeStart: string;
  dateTimeEnd: string;
  status: BookingStatus;
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

export type ClientUser = {
  id: string;
  name: string;
  phone: string;
  createdAt: string;
};

export type GalleryImage = {
  id: string;
  imageUrl: string;
  altText?: string;
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
