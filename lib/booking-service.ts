import { BUSINESS_CONFIG } from "@/lib/config";
import { repository } from "@/lib/repositories";
import { createBookingSchema, createBlockedSlotSchema, updateBookingStatusSchema } from "@/lib/validators/schemas";
import { BookingFilters } from "@/types/domain";
import { generateAvailableSlots, getDayRange } from "./time";
import { addMinutesToIso, overlaps } from "./utils";

export async function listServices() {
  return repository.getServices();
}

export async function listBarbers() {
  return repository.getBarbers();
}

export async function getAvailableSlots(params: { date: string; barberId: string; serviceId: string }) {
  const service = await repository.getServiceById(params.serviceId);
  if (!service) {
    throw new Error("Servico nao encontrado");
  }

  const { start, end } = getDayRange(params.date);
  const bookings = await repository.listBookingsInRange(start, end, params.barberId);
  const blockedSlots = await repository.listBlockedSlots(params.date);

  return generateAvailableSlots({
    date: params.date,
    barberId: params.barberId,
    serviceDurationMinutes: service.durationMinutes,
    barberBookings: bookings,
    blockedSlots,
  });
}

export async function createBooking(input: unknown) {
  const parsed = createBookingSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Dados do agendamento invalidos");
  }

  const data = parsed.data;
  const service = await repository.getServiceById(data.serviceId);
  if (!service) {
    throw new Error("Servico nao encontrado");
  }

  const computedEnd = addMinutesToIso(
    data.start,
    service.durationMinutes + BUSINESS_CONFIG.bufferBetweenBookingsMinutes,
  );

  const conflicts = await repository.listBookingsInRange(data.start, computedEnd, data.barberId);
  if (conflicts.length > 0) {
    throw new Error("Este horario acabou de ser reservado. Escolha outro horario.");
  }

  const blockedSlots = await repository.listBlockedSlots(data.start.slice(0, 10));
  const blockedConflict = blockedSlots.some((slot) => {
    if (slot.barberId && slot.barberId !== data.barberId) {
      return false;
    }
    return overlaps(new Date(data.start), new Date(computedEnd), new Date(slot.dateTimeStart), new Date(slot.dateTimeEnd));
  });

  if (blockedConflict) {
    throw new Error("Este horario esta bloqueado para atendimento.");
  }

  return repository.createBooking({
    barberId: data.barberId,
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

export async function updateBookingStatus(input: unknown) {
  const parsed = updateBookingStatusSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Status invalido");
  }

  const updated = await repository.updateBookingStatus(parsed.data.bookingId, parsed.data.status);
  if (!updated) {
    throw new Error("Agendamento nao encontrado");
  }

  return updated;
}

export async function listBlockedSlots(date?: string) {
  return repository.listBlockedSlots(date);
}

export async function createBlockedSlot(input: unknown) {
  const parsed = createBlockedSlotSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Bloqueio invalido");
  }

  const { barberId, dateTimeStart, dateTimeEnd, reason } = parsed.data;
  if (new Date(dateTimeStart) >= new Date(dateTimeEnd)) {
    throw new Error("O horario final precisa ser maior que o horario inicial");
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
    throw new Error("Bloqueio nao encontrado");
  }
  return true;
}

