import { BUSINESS_CONFIG } from "@/lib/config";
import { formatBRLFromCents, formatDateTimeInTimeZone } from "@/lib/utils";
import type { BookingWithRelations } from "@/types/domain";

export function buildBookingWhatsAppUrl(booking: BookingWithRelations): string {
  let digits = booking.customerPhone.replace(/\D/g, "").replace(/^0+/, "");
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  const dateTime = formatDateTimeInTimeZone(booking.dateTimeStart, BUSINESS_CONFIG.timezone, {
    dateStyle: "full",
    timeStyle: "short",
  });
  const message = encodeURIComponent([
    `Olá, ${booking.customerName}!`,
    "",
    "Seu agendamento na ALFA Barber ficou assim:",
    `Serviço: ${booking.service.name}`,
    `Barbeiro: ${booking.barber.name}`,
    `Data e horário: ${dateTime}`,
    `Valor: ${formatBRLFromCents(booking.service.priceCents)}`,
    `Status: ${booking.status}`,
    "",
    `Código do agendamento: ${booking.id}`,
  ].join("\n"));
  return `https://wa.me/${digits}?text=${message}`;
}
