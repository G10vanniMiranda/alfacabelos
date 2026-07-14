import { BUSINESS_CONFIG } from "@/lib/config";
import { formatBRLFromCents } from "@/lib/utils";
import { BookingWithRelations } from "@/types/domain";
import { buildAppUrl } from "@/lib/app-url";
import { dispatchWhatsAppNotification } from "@/lib/notifications/service";

type SendWhatsAppMessageInput = {
  to: string;
  message: string;
  context?: string;
};

const WHATSAPP_API_URL = process.env.WHATSAPP_API_URL;
const WHATSAPP_API_TOKEN = process.env.WHATSAPP_API_TOKEN;
const WHATSAPP_OWNER_PHONE = process.env.WHATSAPP_OWNER_PHONE;
const WHATSAPP_INSTANCE_ID = process.env.WHATSAPP_INSTANCE_ID;
const WHATSAPP_ENABLED = process.env.WHATSAPP_ENABLED === "true";
const BARBERSHOP_ADDRESS = process.env.BARBERSHOP_ADDRESS;
const WHATSAPP_REQUEST_TIMEOUT_MS = 10_000;
const WHATSAPP_MAX_ATTEMPTS = 3;

export function isWhatsAppConfigured(): boolean {
  return WHATSAPP_ENABLED && Boolean(resolveWhatsAppEndpoint()) && Boolean(WHATSAPP_API_TOKEN);
}

export function normalizeWhatsAppPhone(phone: string): string | null {
  let digits = phone.replace(/\D/g, "");

  while (digits.startsWith("0")) {
    digits = digits.slice(1);
  }

  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) {
    return digits;
  }

  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }

  return null;
}

function formatBookingDate(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "full",
    timeZone: BUSINESS_CONFIG.timezone,
  }).format(new Date(iso));
}

function formatBookingTimeOnly(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: BUSINESS_CONFIG.timezone,
  }).format(new Date(iso));
}

function formatBookingDateTime(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: BUSINESS_CONFIG.timezone,
  }).format(new Date(iso));
}

function resolveWhatsAppEndpoint(): string | null {
  if (!WHATSAPP_API_URL) {
    return null;
  }

  if (!WHATSAPP_INSTANCE_ID) {
    return WHATSAPP_API_URL;
  }

  return WHATSAPP_API_URL.replace("{instanceId}", WHATSAPP_INSTANCE_ID);
}

function buildWhatsAppPayload(phone: string, message: string) {
  const url = WHATSAPP_API_URL?.toLowerCase() ?? "";

  if (url.includes("graph.facebook.com")) {
    return {
      messaging_product: "whatsapp",
      to: phone,
      type: "text",
      text: {
        preview_url: false,
        body: message,
      },
    };
  }

  if (url.includes("evolution")) {
    return {
      number: phone,
      text: message,
      instanceId: WHATSAPP_INSTANCE_ID,
    };
  }

  if (url.includes("z-api") || url.includes("zapi")) {
    return {
      phone,
      message,
    };
  }

  return {
    phone,
    to: phone,
    message,
    text: message,
    instanceId: WHATSAPP_INSTANCE_ID,
  };
}

export async function sendWhatsAppMessage({ to, message, context = "whatsapp" }: SendWhatsAppMessageInput): Promise<boolean> {
  if (!WHATSAPP_ENABLED) {
    console.info(`[whatsapp] notificacao ignorada (${context}): WHATSAPP_ENABLED diferente de true`);
    return false;
  }

  const phone = normalizeWhatsAppPhone(to);
  if (!phone) {
    console.warn(`[whatsapp] telefone invalido para notificacao (${context})`);
    return false;
  }

  const endpoint = resolveWhatsAppEndpoint();
  if (!endpoint || !WHATSAPP_API_TOKEN) {
    console.warn(`[whatsapp] configuracao incompleta para envio (${context})`);
    return false;
  }

  for (let attempt = 1; attempt <= WHATSAPP_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), WHATSAPP_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${WHATSAPP_API_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(buildWhatsAppPayload(phone, message)),
        signal: controller.signal,
      });
      if (response.ok) {
        console.info("[whatsapp]", JSON.stringify({ event: "sent", context, attempt }));
        return true;
      }
      const retryable = response.status === 429 || response.status >= 500;
      console.warn("[whatsapp]", JSON.stringify({ event: "provider_error", context, attempt, status: response.status, retryable }));
      if (!retryable || attempt === WHATSAPP_MAX_ATTEMPTS) {
        const providerError = new Error(`Falha ao enviar WhatsApp (${response.status})`) as Error & { retryable?: boolean };
        providerError.retryable = retryable;
        throw providerError;
      }
    } catch (error) {
      if ((error as { retryable?: boolean })?.retryable === false || attempt === WHATSAPP_MAX_ATTEMPTS) throw error;
      console.warn("[whatsapp]", JSON.stringify({ event: "network_retry", context, attempt }));
    } finally {
      clearTimeout(timeout);
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 500));
  }
  return false;
}

export function buildOwnerBookingNotification(booking: BookingWithRelations, observations?: string): string {
  return [
    "💈 Novo agendamento - Alfa Cabelos",
    "",
    `Cliente: ${booking.customerName}`,
    `Telefone: ${booking.customerPhone}`,
    `Serviço: ${booking.service.name}`,
    `Barbeiro: ${booking.barber?.name ?? "Não informado"}`,
    `Data: ${formatBookingDate(booking.dateTimeStart)}`,
    `Horário: ${formatBookingTimeOnly(booking.dateTimeStart)}`,
    `Identificador: ${booking.id}`,
    "",
    `Observações: ${observations?.trim() || "Não informadas"}`,
  ].join("\n");
}

export function buildClientBookingConfirmation(booking: BookingWithRelations): string {
  if (booking.confirmationToken) {
    return buildClientPreBookingConfirmation(booking);
  }

  const lines = [
    `Olá, ${booking.customerName}! 💈`,
    "",
    "Seu agendamento na Alfa Cabelos foi confirmado.",
    "",
    `Serviço: ${booking.service.name}`,
    `Profissional: ${booking.barber.name}`,
    `Data: ${formatBookingDate(booking.dateTimeStart)}`,
    `Horário: ${formatBookingTimeOnly(booking.dateTimeStart)}`,
  ];

  if (BARBERSHOP_ADDRESS?.trim()) {
    lines.push(`Endereço: ${BARBERSHOP_ADDRESS.trim()}`);
  }

  lines.push(
    "",
    "Chegue com alguns minutos de antecedência.",
    "Qualquer dúvida, fale conosco por aqui.",
  );

  return lines.join("\n");
}

export function buildBookingConfirmationLink(booking: BookingWithRelations): string | null {
  if (!booking.confirmationToken) {
    return null;
  }

  return buildAppUrl(`/confirmar-agendamento?token=${encodeURIComponent(booking.confirmationToken)}`);
}

export function buildClientPreBookingConfirmation(booking: BookingWithRelations): string {
  const link = buildBookingConfirmationLink(booking);
  const lines = [
    `Ola, ${booking.customerName}!`,
    "",
    "Seu horario na Alfa Cabelos foi pre-agendado.",
    "",
    `Servico: ${booking.service.name}`,
    `Data: ${formatBookingDate(booking.dateTimeStart)}`,
    `Horario: ${formatBookingTimeOnly(booking.dateTimeStart)}`,
  ];

  if (link) {
    lines.push(
      "",
      "Para confirmar seu agendamento, clique no link abaixo:",
      link,
      "",
      "Voce nao precisa ter senha para confirmar esse agendamento.",
    );
  } else {
    lines.push("", "Entre em contato conosco para confirmar seu agendamento.");
  }

  return lines.join("\n");
}

export async function notifyOwnerAboutClientBooking(booking: BookingWithRelations, observations?: string) {
  if (!WHATSAPP_OWNER_PHONE) {
    if (WHATSAPP_ENABLED) {
      console.warn("[whatsapp] WHATSAPP_OWNER_PHONE ausente; notificacao ao dono ignorada");
    }
    return;
  }

  await dispatchWhatsAppNotification({
    event: "BOOKING_CREATED_BY_CLIENT",
    bookingId: booking.id,
    idempotencyKey: `booking:${booking.id}:owner-created`,
    to: WHATSAPP_OWNER_PHONE,
    message: buildOwnerBookingNotification(booking, observations),
    context: `novo-agendamento:${booking.id}`,
  });
}

export async function notifyClientAboutAdminBooking(booking: BookingWithRelations) {
  await dispatchWhatsAppNotification({
    event: "BOOKING_CREATED_BY_STAFF",
    bookingId: booking.id,
    idempotencyKey: `booking:${booking.id}:client-created`,
    to: booking.customerPhone,
    message: buildClientBookingConfirmation(booking),
    context: `confirmacao-cliente:${booking.id}`,
  });
}

export async function notifyOwnerAboutBookingEvent(
  booking: BookingWithRelations,
  event: "BOOKING_RESCHEDULED" | "BOOKING_CANCELLED",
) {
  if (!WHATSAPP_OWNER_PHONE) return { status: "not_configured" as const };
  const label = event === "BOOKING_RESCHEDULED" ? "Agendamento reagendado" : "Agendamento cancelado";
  return dispatchWhatsAppNotification({
    event,
    bookingId: booking.id,
    idempotencyKey: event === "BOOKING_RESCHEDULED"
      ? `booking:${booking.id}:rescheduled:${booking.dateTimeStart}`
      : `booking:${booking.id}:cancelled`,
    to: WHATSAPP_OWNER_PHONE,
    message: `${label}\n\n${buildBookingWhatsAppMessage(booking)}`,
    context: `${event.toLowerCase()}:${booking.id}`,
  });
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
  const phone = normalizeWhatsAppPhone(booking.customerPhone) ?? booking.customerPhone.replace(/\D/g, "");
  const message = encodeURIComponent(buildBookingWhatsAppMessage(booking));

  return `https://wa.me/${phone}?text=${message}`;
}
