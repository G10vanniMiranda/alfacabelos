import { BUSINESS_CONFIG } from "@/lib/config";
import { DEFAULT_BARBER_ID } from "@/lib/constants/barber";
import { repository } from "@/lib/repositories";
import {
  createGalleryImageSchema,
  createBlockedSlotSchema,
  createBookingSchema,
  createServiceSchema,
  deleteGalleryImageSchema,
  updateBookingStatusSchema,
  updateServiceSchema,
} from "@/lib/validators/schemas";
import { BookingFilters } from "@/types/domain";
import { generateAvailableSlots, getDayRange } from "./time";
import { addMinutesToIso, overlaps } from "./utils";

export async function listServices() {
  return repository.getServices();
}

export async function listGalleryImages() {
  return repository.listGalleryImages();
}

export async function createService(input: unknown) {
  const parsed = createServiceSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Dados do serviço inválidos");
  }

  return repository.createService({
    name: parsed.data.name,
    priceCents: parsed.data.priceCents,
    durationMinutes: 45,
  });
}

export async function updateService(input: unknown) {
  const parsed = updateServiceSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Dados do serviço inválidos");
  }

  const updated = await repository.updateService(parsed.data.serviceId, {
    name: parsed.data.name,
    priceCents: parsed.data.priceCents,
  });

  if (!updated) {
    throw new Error("Serviço não encontrado");
  }

  return updated;
}

export async function deleteService(serviceId: string) {
  if (!serviceId) {
    throw new Error("Serviço inválido");
  }

  const deleted = await repository.deleteService(serviceId);
  if (!deleted) {
    throw new Error("Serviço não encontrado");
  }
}

export async function createGalleryImage(input: unknown) {
  const parsed = createGalleryImageSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Dados da foto inválidos");
  }

  return repository.createGalleryImage({
    imageUrl: parsed.data.imageUrl,
    altText: parsed.data.altText,
  });
}

export async function deleteGalleryImage(input: unknown) {
  const parsed = deleteGalleryImageSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Foto inválida");
  }

  const deleted = await repository.deleteGalleryImage(parsed.data.galleryImageId);
  if (!deleted) {
    throw new Error("Foto não encontrada");
  }

  return true;
}

export async function listBarbers() {
  return repository.getBarbers();
}

export async function getAvailableSlots(params: { date: string; barberId?: string; serviceId: string }) {
  const service = await repository.getServiceById(params.serviceId);
  if (!service) {
    throw new Error("Serviço não encontrado");
  }

  const { start, end } = getDayRange(params.date);
  const barberId = params.barberId || DEFAULT_BARBER_ID;
  const bookings = await repository.listBookingsInRange(start, end, barberId);
  const blockedSlots = await repository.listBlockedSlots(params.date);

  return generateAvailableSlots({
    date: params.date,
    barberId,
    serviceDurationMinutes: service.durationMinutes,
    barberBookings: bookings,
    blockedSlots,
  });
}

export async function createBooking(input: unknown) {
  const parsed = createBookingSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Dados do agendamento inválidos");
  }

  const data = parsed.data;
  const barberId = data.barberId ?? DEFAULT_BARBER_ID;
  const service = await repository.getServiceById(data.serviceId);
  if (!service) {
    throw new Error("Serviço não encontrado");
  }

  const computedEnd = addMinutesToIso(
    data.start,
    service.durationMinutes + BUSINESS_CONFIG.bufferBetweenBookingsMinutes,
  );

  const conflicts = await repository.listBookingsInRange(data.start, computedEnd, barberId);
  if (conflicts.length > 0) {
    throw new Error("Este horário acabou de ser reservado. Escolha outro horário.");
  }

  const blockedSlots = await repository.listBlockedSlots(data.start.slice(0, 10));
  const blockedConflict = blockedSlots.some((slot) => {
    if (slot.barberId && slot.barberId !== barberId) {
      return false;
    }
    return overlaps(new Date(data.start), new Date(computedEnd), new Date(slot.dateTimeStart), new Date(slot.dateTimeEnd));
  });

  if (blockedConflict) {
    throw new Error("Este horário está bloqueado para atendimento.");
  }

  return repository.createBooking({
    barberId,
    serviceId: data.serviceId,
    customerName: data.customerName,
    customerPhone: data.customerPhone,
    dateTimeStart: data.start,
    dateTimeEnd: computedEnd,
  });
}

export async function getBookingById(bookingId: string) {
  return repository.getBookingById(bookingId);
}

export async function listAdminBookings(filters: BookingFilters) {
  return repository.listBookings(filters);
}

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

export async function listClientBookings(customerPhone: string) {
  const normalized = normalizePhone(customerPhone);
  const bookings = await repository.listBookings({});
  return bookings.filter((booking) => normalizePhone(booking.customerPhone) === normalized);
}

export async function cancelClientBooking(input: { bookingId: string; customerPhone: string }) {
  const booking = await repository.getBookingById(input.bookingId);
  if (!booking) {
    throw new Error("Agendamento não encontrado");
  }

  if (normalizePhone(booking.customerPhone) !== normalizePhone(input.customerPhone)) {
    throw new Error("Você não tem permissão para cancelar este agendamento");
  }

  if (booking.status === "CANCELADO") {
    return booking;
  }

  return repository.updateBookingStatus(booking.id, "CANCELADO");
}

export async function updateBookingStatus(input: unknown) {
  const parsed = updateBookingStatusSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Status inválido");
  }

  const updated = await repository.updateBookingStatus(parsed.data.bookingId, parsed.data.status);
  if (!updated) {
    throw new Error("Agendamento não encontrado");
  }

  return updated;
}

export async function listBlockedSlots(date?: string) {
  return repository.listBlockedSlots(date);
}

export async function createBlockedSlot(input: unknown) {
  const parsed = createBlockedSlotSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Bloqueio inválido");
  }

  const { barberId, dateTimeStart, dateTimeEnd, reason } = parsed.data;
  if (new Date(dateTimeStart) >= new Date(dateTimeEnd)) {
    throw new Error("O horário final precisa ser maior que o horário inicial");
  }

  return repository.createBlockedSlot({
    barberId,
    dateTimeStart,
    dateTimeEnd,
    reason,
  });
}

export async function deleteBlockedSlot(blockedSlotId: string) {
  const deleted = await repository.deleteBlockedSlot(blockedSlotId);
  if (!deleted) {
    throw new Error("Bloqueio não encontrado");
  }
  return true;
}

