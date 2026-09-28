import { BUSINESS_CONFIG } from "@/lib/config";
import { formatBRLFromCents } from "@/lib/utils";
import { buildAppUrl } from "@/lib/app-url";
import { normalizeWhatsAppPhone } from "@/lib/notifications/phone";

export { normalizeWhatsAppPhone } from "@/lib/notifications/phone";

const BARBERSHOP_ADDRESS = process.env.BARBERSHOP_ADDRESS;

export type BookingNotificationSnapshot = {
  id: string;
  customerName: string;
  customerPhone: string;
  observations?: string | null;
  dateTimeStart: string;
  status: string;
  confirmationToken?: string | null;
  service: { name: string; priceCents: number };
  barber: { name: string };
};

export function isWhatsAppConfigured(): boolean {
  return process.env.WHATSAPP_ENABLED === "true"
    && Boolean(process.env.WHATSAPP_API_URL?.trim())
    && Boolean(process.env.WHATSAPP_API_TOKEN?.trim());
}

function formatBookingDate(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "full", timeZone: BUSINESS_CONFIG.timezone }).format(new Date(iso));
}

function formatBookingTimeOnly(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit", minute: "2-digit", timeZone: BUSINESS_CONFIG.timezone,
  }).format(new Date(iso));
}

function formatBookingDateTime(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "full", timeStyle: "short", timeZone: BUSINESS_CONFIG.timezone,
  }).format(new Date(iso));
}

export function buildOwnerBookingNotification(booking: BookingNotificationSnapshot, observations?: string): string {
  return [
    "💈 Novo agendamento - Alfa Cabelos", "",
    `Cliente: ${booking.customerName}`,
    `Telefone: ${booking.customerPhone}`,
    `Serviço: ${booking.service.name}`,
    `Barbeiro: ${booking.barber.name}`,
    `Data: ${formatBookingDate(booking.dateTimeStart)}`,
    `Horário: ${formatBookingTimeOnly(booking.dateTimeStart)}`,
    `Identificador: ${booking.id}`, "",
    `Observações: ${observations?.trim() || "Não informadas"}`,
  ].join("\n");
}

export function buildClientBookingConfirmation(booking: BookingNotificationSnapshot): string {
  if (booking.confirmationToken) return buildClientPreBookingConfirmation(booking);
  const lines = [
    `Olá, ${booking.customerName}! 💈`, "", "Seu agendamento na Alfa Cabelos foi confirmado.", "",
    `Serviço: ${booking.service.name}`,
    `Profissional: ${booking.barber.name}`,
    `Data: ${formatBookingDate(booking.dateTimeStart)}`,
    `Horário: ${formatBookingTimeOnly(booking.dateTimeStart)}`,
  ];
  if (BARBERSHOP_ADDRESS?.trim()) lines.push(`Endereço: ${BARBERSHOP_ADDRESS.trim()}`);
  lines.push("", "Chegue com alguns minutos de antecedência.", "Qualquer dúvida, fale conosco por aqui.");
  return lines.join("\n");
}

export function buildBookingConfirmationLink(booking: BookingNotificationSnapshot): string | null {
  if (!booking.confirmationToken) return null;
  return buildAppUrl(`/confirmar-agendamento?token=${encodeURIComponent(booking.confirmationToken)}`);
}

export function buildClientPreBookingConfirmation(booking: BookingNotificationSnapshot): string {
  const link = buildBookingConfirmationLink(booking);
  const lines = [
    `Olá, ${booking.customerName}!`, "", "Seu horário na Alfa Cabelos foi pré-agendado.", "",
    `Serviço: ${booking.service.name}`,
    `Data: ${formatBookingDate(booking.dateTimeStart)}`,
    `Horário: ${formatBookingTimeOnly(booking.dateTimeStart)}`,
  ];
  if (link) {
    lines.push("", "Para confirmar seu agendamento, clique no link abaixo:", link, "", "Você não precisa ter senha para confirmar esse agendamento.");
  } else {
    lines.push("", "Entre em contato conosco para confirmar seu agendamento.");
  }
  return lines.join("\n");
}

export function buildBookingWhatsAppMessage(booking: BookingNotificationSnapshot): string {
  return [
    `Olá, ${booking.customerName}!`, "", "Seu agendamento na ALFA Barber ficou assim:",
    `Serviço: ${booking.service.name}`,
    `Barbeiro: ${booking.barber.name}`,
    `Data e horário: ${formatBookingDateTime(booking.dateTimeStart)}`,
    `Valor: ${formatBRLFromCents(booking.service.priceCents)}`,
    `Status: ${booking.status}`, "", `Código do agendamento: ${booking.id}`,
  ].join("\n");
}

export function buildBookingWhatsAppUrl(booking: BookingNotificationSnapshot): string {
  const phone = normalizeWhatsAppPhone(booking.customerPhone) ?? booking.customerPhone.replace(/\D/g, "");
  return `https://wa.me/${phone}?text=${encodeURIComponent(buildBookingWhatsAppMessage(booking))}`;
}
