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

export function buildOwnerBookingNotification(
  booking: BookingNotificationSnapshot,
  observations?: string,
  heading = "💈 Novo agendamento - Alfa Cabelos",
): string {
  return [
    heading, "",
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
    `Código: ${bookingReference(booking.id)}`,
  ];
  if (BARBERSHOP_ADDRESS?.trim()) lines.push(`Endereço: ${BARBERSHOP_ADDRESS.trim()}`);
  lines.push("", "Chegue com alguns minutos de antecedência.", "Qualquer dúvida, fale conosco por aqui.");
  return lines.join("\n");
}

/** Receipt for a booking the client made themselves (it is registered, not yet confirmed by the shop). */
export function buildClientBookingReceipt(booking: BookingNotificationSnapshot): string {
  return [
    `Olá, ${booking.customerName}! 💈`, "", "Recebemos o seu agendamento na Alfa Cabelos.", "",
    ...clientBookingLines(booking),
    "", "Se precisar remarcar ou cancelar, acesse sua área de cliente no site.",
  ].join("\n");
}

export type BookingChangeActor = "CLIENT" | "STAFF";

function clientBookingLines(booking: BookingNotificationSnapshot): string[] {
  return [
    `Serviço: ${booking.service.name}`,
    `Profissional: ${booking.barber.name}`,
    `Data: ${formatBookingDate(booking.dateTimeStart)}`,
    `Horário: ${formatBookingTimeOnly(booking.dateTimeStart)}`,
    `Código: ${bookingReference(booking.id)}`,
  ];
}

function ownerBookingLines(booking: BookingNotificationSnapshot): string[] {
  return [
    `Cliente: ${booking.customerName}`,
    `Telefone: ${booking.customerPhone}`,
    `Serviço: ${booking.service.name}`,
    `Barbeiro: ${booking.barber.name}`,
    `Data: ${formatBookingDate(booking.dateTimeStart)}`,
    `Horário: ${formatBookingTimeOnly(booking.dateTimeStart)}`,
    `Identificador: ${booking.id}`,
  ];
}

/** Short, non-secret reference the client can quote; never a confirmation token. */
export function bookingReference(id: string): string {
  return `#${id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8).toUpperCase()}`;
}

const ACTOR_LABEL: Record<BookingChangeActor, string> = { CLIENT: "cliente", STAFF: "equipe" };

export function buildBookingCancellationMessage(
  booking: BookingNotificationSnapshot,
  audience: "OWNER" | "CLIENT",
  actor: BookingChangeActor,
): string {
  if (audience === "OWNER") {
    return ["❌ Agendamento cancelado - Alfa Cabelos", "", `Cancelado por: ${ACTOR_LABEL[actor]}`, ...ownerBookingLines(booking)].join("\n");
  }
  const opening = actor === "CLIENT"
    ? "Confirmamos o cancelamento do seu agendamento na Alfa Cabelos."
    : "Seu agendamento na Alfa Cabelos foi cancelado pela nossa equipe.";
  return [
    `Olá, ${booking.customerName}.`, "", opening, "", ...clientBookingLines(booking),
    "", "Para marcar um novo horário, acesse o site ou fale conosco por aqui.",
  ].join("\n");
}

export function buildBookingRescheduleMessage(
  booking: BookingNotificationSnapshot,
  audience: "OWNER" | "CLIENT",
  actor: BookingChangeActor,
): string {
  if (audience === "OWNER") {
    return ["🔁 Agendamento remarcado - Alfa Cabelos", "", `Remarcado por: ${ACTOR_LABEL[actor]}`, "Novo horário:", ...ownerBookingLines(booking)].join("\n");
  }
  const opening = actor === "CLIENT"
    ? "Seu agendamento na Alfa Cabelos foi remarcado com sucesso."
    : "Seu agendamento na Alfa Cabelos foi remarcado pela nossa equipe.";
  return [`Olá, ${booking.customerName}!`, "", opening, "", "Novo horário:", ...clientBookingLines(booking)].join("\n");
}

const SERIES_LISTED_OCCURRENCES = 10;

function formatOccurrenceLine(iso: string): string {
  const date = new Intl.DateTimeFormat("pt-BR", {
    weekday: "short", day: "2-digit", month: "2-digit", timeZone: BUSINESS_CONFIG.timezone,
  }).format(new Date(iso));
  return `• ${date} às ${formatBookingTimeOnly(iso)}`;
}

export type SeriesNotificationEvent = "BOOKING_CREATED_BY_CLIENT" | "BOOKING_CREATED_BY_STAFF" | "BOOKING_CANCELLED" | "BOOKING_RESCHEDULED";

/**
 * One message for a whole group of occurrences (series creation, or a cancellation/reschedule
 * that reaches several occurrences). Lists at most 10 dates to stay well under channel limits.
 */
export function buildSeriesNotificationMessage(input: {
  event: SeriesNotificationEvent;
  audience: "OWNER" | "CLIENT";
  actor: BookingChangeActor;
  occurrences: BookingNotificationSnapshot[];
  seriesId: string;
}): string {
  const occurrences = [...input.occurrences].sort((a, b) => a.dateTimeStart.localeCompare(b.dateTimeStart));
  const first = occurrences[0]!;
  const last = occurrences[occurrences.length - 1]!;
  const owner = input.audience === "OWNER";
  const headings: Record<SeriesNotificationEvent, [string, string]> = {
    BOOKING_CREATED_BY_CLIENT: ["💈 Nova série de agendamentos - Alfa Cabelos", "Recebemos os seus agendamentos recorrentes na Alfa Cabelos."],
    BOOKING_CREATED_BY_STAFF: ["📅 Série criada pela equipe - Alfa Cabelos", "Seus horários recorrentes na Alfa Cabelos foram pré-agendados."],
    BOOKING_CANCELLED: ["❌ Horários cancelados - Alfa Cabelos", input.actor === "CLIENT"
      ? "Confirmamos o cancelamento destes horários na Alfa Cabelos."
      : "Estes horários na Alfa Cabelos foram cancelados pela nossa equipe."],
    BOOKING_RESCHEDULED: ["🔁 Horários remarcados - Alfa Cabelos", input.actor === "CLIENT"
      ? "Seus horários na Alfa Cabelos foram remarcados."
      : "Seus horários na Alfa Cabelos foram remarcados pela nossa equipe."],
  };
  const [ownerHeading, clientOpening] = headings[input.event];
  const lines = owner ? [ownerHeading, ""] : [`Olá, ${first.customerName}!`, "", clientOpening, ""];
  if (owner && input.event === "BOOKING_CANCELLED") lines.push(`Cancelado por: ${ACTOR_LABEL[input.actor]}`);
  if (owner && input.event === "BOOKING_RESCHEDULED") lines.push(`Remarcado por: ${ACTOR_LABEL[input.actor]}`);
  if (owner) lines.push(`Cliente: ${first.customerName}`, `Telefone: ${first.customerPhone}`);
  lines.push(
    `Serviço: ${first.service.name}`,
    `${owner ? "Barbeiro" : "Profissional"}: ${first.barber.name}`,
    `${input.event === "BOOKING_RESCHEDULED" ? "Novos horários" : "Horários"}: ${occurrences.length}`,
    `Período: ${formatBookingDate(first.dateTimeStart)} a ${formatBookingDate(last.dateTimeStart)}`,
    "",
    ...occurrences.slice(0, SERIES_LISTED_OCCURRENCES).map((item) => formatOccurrenceLine(item.dateTimeStart)),
  );
  if (occurrences.length > SERIES_LISTED_OCCURRENCES) lines.push(`… e mais ${occurrences.length - SERIES_LISTED_OCCURRENCES} horário(s)`);
  lines.push("", owner ? `Série: ${input.seriesId}` : `Código: ${bookingReference(first.id)}`);
  if (!owner && input.event === "BOOKING_CREATED_BY_STAFF") {
    // Each occurrence keeps its own token; only the first one's link is sent (see booking-intents).
    const link = buildBookingConfirmationLink(first);
    lines.push("", link
      ? `Para confirmar o primeiro horário, use o link: ${link}\nOs demais horários ficam reservados; para confirmá-los, fale conosco.`
      : "Entre em contato conosco para confirmar seus horários.");
  }
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
    `Código: ${bookingReference(booking.id)}`,
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
