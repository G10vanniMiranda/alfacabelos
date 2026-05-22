import { BUSINESS_CONFIG } from "@/lib/config";
import { formatBRLFromCents } from "@/lib/utils";
import { BookingWithRelations } from "@/types/domain";

function normalizeWhatsAppPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");

  if (digits.startsWith("55")) {
    return digits;
  }

  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }

  return digits;
}

function formatBookingDateTime(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: BUSINESS_CONFIG.timezone,
  }).format(new Date(iso));
}

export function buildBookingWhatsAppMessage(booking: BookingWithRelations): string {
  return [
    `Ola, ${booking.customerName}!`,
    "",
    "Seu agendamento na ALFA Barber ficou assim:",
    `Servico: ${booking.service.name}`,
    `Barbeiro: ${booking.barber.name}`,
    `Data e horario: ${formatBookingDateTime(booking.dateTimeStart)}`,
    `Valor: ${formatBRLFromCents(booking.service.priceCents)}`,
    `Status: ${booking.status}`,
    "",
    `Codigo do agendamento: ${booking.id}`,
  ].join("\n");
}

export function buildBookingWhatsAppUrl(booking: BookingWithRelations): string {
  const phone = normalizeWhatsAppPhone(booking.customerPhone);
  const message = encodeURIComponent(buildBookingWhatsAppMessage(booking));

  return `https://wa.me/${phone}?text=${message}`;
}
