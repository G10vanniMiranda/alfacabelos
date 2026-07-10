import { unstable_cache } from "next/cache";
import { randomBytes } from "node:crypto";
import { BUSINESS_CONFIG } from "@/lib/config";
import { isClosedOperatingWindow } from "@/lib/constants/availability";
import { DEFAULT_BARBER_ID } from "@/lib/constants/barber";
import { repository } from "@/lib/repositories";
import {
  createGalleryImageSchema,
  createBlockedSlotSchema,
  createBookingSchema,
  createServiceSchema,
  deleteGalleryImageSchema,
  replaceBarberDayAvailabilitySchema,
  updateAdminBookingSchema,
  updateBookingPaymentStatusSchema,
  updateBookingStatusSchema,
  updateServiceSchema,
} from "@/lib/validators/schemas";
import { BookingFilters } from "@/types/domain";
import { generateAvailableSlots, getDayRange } from "./time";
import { addMinutesToIso, getLocalDateInput, overlaps } from "./utils";
import { registerRateLimitEvent, sha256 } from "./security";

const HOME_REVALIDATE_SECONDS = 60 * 15;

const getCachedServices = unstable_cache(async () => repository.getServices(), ["services"], {
  revalidate: HOME_REVALIDATE_SECONDS,
  tags: ["services"],
});

const getCachedGalleryImages = unstable_cache(async () => repository.listGalleryImages(), ["gallery-images"], {
  revalidate: HOME_REVALIDATE_SECONDS,
  tags: ["gallery-images"],
});

const getCachedBarbers = unstable_cache(async () => repository.getBarbers(), ["barbers"], {
  revalidate: HOME_REVALIDATE_SECONDS,
  tags: ["barbers"],
});

export async function listServices() {
  return getCachedServices();
}

export async function listGalleryImages() {
  return getCachedGalleryImages();
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
    mediaType: parsed.data.mediaType ?? "IMAGE",
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
  return getCachedBarbers();
}

export async function getAvailableSlots(params: { date: string; barberId?: string; serviceId: string }) {
  const service = await repository.getServiceById(params.serviceId);
  if (!service) {
    throw new Error("Serviço não encontrado");
  }

  const { start, end } = getDayRange(params.date);
  const barberId = params.barberId || DEFAULT_BARBER_ID;
  const [bookings, blockedSlots, availabilities] = await Promise.all([
    repository.listBookingsInRange(start, end, barberId),
    repository.listBlockedSlots(params.date),
    repository.listBarberAvailabilities(barberId),
  ]);

  return generateAvailableSlots({
    date: params.date,
    barberId,
    serviceDurationMinutes: service.durationMinutes,
    barberBookings: bookings,
    blockedSlots,
    operatingHours: availabilities
      .map((item) => ({
        dayOfWeek: item.dayOfWeek,
        open: item.openTime,
        close: item.closeTime,
      }))
      .filter((item) => !isClosedOperatingWindow(item)),
  });
}

export async function createBooking(input: unknown, options?: { clientId?: string }) {
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

  const requestedDate = getLocalDateInput(data.start, BUSINESS_CONFIG.timezone);
  const { start: dayStart, end: dayEnd } = getDayRange(requestedDate);
  const [dayBookings, dayBlockedSlots, availabilities] = await Promise.all([
    repository.listBookingsInRange(dayStart, dayEnd, barberId),
    repository.listBlockedSlots(requestedDate),
    repository.listBarberAvailabilities(barberId),
  ]);

  const availableSlots = generateAvailableSlots({
    date: requestedDate,
    barberId,
    serviceDurationMinutes: service.durationMinutes,
    barberBookings: dayBookings,
    blockedSlots: dayBlockedSlots,
    operatingHours: availabilities
      .map((item) => ({
        dayOfWeek: item.dayOfWeek,
        open: item.openTime,
        close: item.closeTime,
      }))
      .filter((item) => !isClosedOperatingWindow(item)),
  });

  if (!availableSlots.some((slot) => slot.start === data.start)) {
    throw new Error("O horario selecionado nao esta mais disponivel.");
  }

  const conflicts = await repository.listBookingsInRange(data.start, computedEnd, barberId);
  if (conflicts.length > 0) {
    throw new Error("Este horário acabou de ser reservado. Escolha outro horário.");
  }

  const blockedSlots = await repository.listBlockedSlots(getLocalDateInput(data.start, BUSINESS_CONFIG.timezone));
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
    clientId: options?.clientId,
    customerName: data.customerName,
    customerPhone: data.customerPhone,
    observations: data.observations,
    dateTimeStart: data.start,
    dateTimeEnd: computedEnd,
    createdBy: "CLIENT",
  });
}

function createConfirmationToken(): string {
  return randomBytes(32).toString("base64url");
}

function hashConfirmationToken(token: string): string {
  return sha256(token);
}

function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

export async function createBarberBooking(input: unknown) {
  const parsed = createBookingSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Dados do agendamento invalidos");
  }

  const data = parsed.data;
  const barberId = data.barberId ?? DEFAULT_BARBER_ID;
  const service = await repository.getServiceById(data.serviceId);
  if (!service) {
    throw new Error("Servico nao encontrado");
  }

  const computedEnd = addMinutesToIso(
    data.start,
    service.durationMinutes + BUSINESS_CONFIG.bufferBetweenBookingsMinutes,
  );

  const conflicts = await repository.listBookingsInRange(data.start, computedEnd, barberId);
  if (conflicts.length > 0) {
    throw new Error("Este horario acabou de ser reservado. Escolha outro horario.");
  }

  const blockedSlots = await repository.listBlockedSlots(getLocalDateInput(data.start, BUSINESS_CONFIG.timezone));
  const blockedConflict = blockedSlots.some((slot) => {
    if (slot.barberId && slot.barberId !== barberId) {
      return false;
    }
    return overlaps(new Date(data.start), new Date(computedEnd), new Date(slot.dateTimeStart), new Date(slot.dateTimeEnd));
  });

  if (blockedConflict) {
    throw new Error("Este horario esta bloqueado para atendimento.");
  }

  const client = await repository.upsertPendingClient({
    name: data.customerName,
    phone: data.customerPhone,
  });

  const rawConfirmationToken = createConfirmationToken();
  const booking = await repository.createBooking({
    barberId,
    serviceId: data.serviceId,
    clientId: client.id,
    customerName: data.customerName,
    customerPhone: data.customerPhone,
    observations: data.observations,
    dateTimeStart: data.start,
    dateTimeEnd: computedEnd,
    status: "PENDENTE",
    confirmationTokenHash: hashConfirmationToken(rawConfirmationToken),
    confirmationTokenExpiresAt: addHours(new Date(), 48).toISOString(),
    createdBy: "BARBER",
  });

  return {
    ...booking,
    confirmationToken: rawConfirmationToken,
  };
}

export async function updateAdminBooking(input: unknown) {
  const parsed = updateAdminBookingSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Dados do agendamento invalidos");
  }

  const service = await repository.getServiceById(parsed.data.serviceId);
  if (!service) {
    throw new Error("Servico nao encontrado");
  }

  const computedEnd = addMinutesToIso(
    parsed.data.start,
    service.durationMinutes + BUSINESS_CONFIG.bufferBetweenBookingsMinutes,
  );

  const updated = await repository.updateBooking({
    bookingId: parsed.data.bookingId,
    barberId: parsed.data.barberId,
    serviceId: parsed.data.serviceId,
    customerName: parsed.data.customerName,
    customerPhone: parsed.data.customerPhone,
    observations: parsed.data.observations,
    dateTimeStart: parsed.data.start,
    dateTimeEnd: computedEnd,
  });

  if (!updated) {
    throw new Error("Agendamento nao encontrado");
  }

  return updated;
}

export async function getBookingById(bookingId: string) {
  return repository.getBookingById(bookingId);
}

export async function getBookingByConfirmationToken(token: string) {
  if (!token || token.length < 32) {
    return undefined;
  }

  return repository.getBookingByConfirmationToken(token);
}

type PublicConfirmationState =
  | {
    valid: true;
    reason: null;
    booking: NonNullable<Awaited<ReturnType<typeof getBookingByConfirmationToken>>>;
  }
  | {
    valid: false;
    reason: "invalid" | "used" | "expired" | "not_pending";
    booking?: Awaited<ReturnType<typeof getBookingByConfirmationToken>>;
  };

export function getPublicConfirmationState(
  booking: Awaited<ReturnType<typeof getBookingByConfirmationToken>>,
): PublicConfirmationState {
  if (!booking) {
    return { valid: false, reason: "invalid" as const };
  }

  if (booking.confirmationTokenUsedAt) {
    return { valid: false, reason: "used" as const, booking };
  }

  if (!booking.confirmationTokenExpiresAt || new Date(booking.confirmationTokenExpiresAt) <= new Date()) {
    return { valid: false, reason: "expired" as const, booking };
  }

  if (booking.status !== "PENDENTE") {
    return { valid: false, reason: "not_pending" as const, booking };
  }

  return { valid: true, reason: null, booking };
}

export async function confirmBookingByToken(token: string) {
  if (!token || token.length < 32) {
    throw new Error("Link de confirmacao invalido");
  }

  const rateLimit = await registerRateLimitEvent({
    scope: "booking-confirmation",
    identifier: hashConfirmationToken(token),
    windowSeconds: 15 * 60,
    maxAttempts: 12,
  });
  if (rateLimit.blocked) {
    throw new Error("Muitas tentativas. Aguarde alguns minutos e tente novamente.");
  }

  const confirmed = await repository.confirmBookingByToken(token);
  if (!confirmed) {
    throw new Error("Link de confirmacao invalido, expirado ou ja utilizado");
  }

  return confirmed;
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

export async function confirmClientBooking(input: { bookingId: string; customerPhone: string }) {
  const booking = await repository.getBookingById(input.bookingId);
  if (!booking) {
    throw new Error("Agendamento nao encontrado");
  }

  if (normalizePhone(booking.customerPhone) !== normalizePhone(input.customerPhone)) {
    throw new Error("Voce nao tem permissao para confirmar este agendamento");
  }

  if (booking.status === "CANCELADO") {
    throw new Error("Nao e possivel confirmar um agendamento cancelado");
  }

  if (booking.status === "CONFIRMADO") {
    return booking;
  }

  return repository.updateBookingStatus(booking.id, "CONFIRMADO");
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

export async function updateBookingPaymentStatus(input: unknown) {
  const parsed = updateBookingPaymentStatusSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Status de pagamento invalido");
  }

  const updated = await repository.updateBookingPaymentStatus(parsed.data.bookingId, parsed.data.paymentStatus);
  if (!updated) {
    throw new Error("Agendamento nao encontrado");
  }

  return updated;
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

export async function listBarberAvailabilities(barberId: string) {
  if (!barberId) {
    throw new Error("Barbeiro invalido");
  }
  return repository.listBarberAvailabilities(barberId);
}

export async function replaceBarberDayAvailability(input: unknown) {
  const parsed = replaceBarberDayAvailabilitySchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Disponibilidade invalida");
  }

  return repository.replaceBarberDayAvailabilities(parsed.data);
}
