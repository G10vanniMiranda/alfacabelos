import { randomUUID } from "node:crypto";
import type { NotificationEvent } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type NotificationDispatchResult = {
  status: "not_configured" | "pending" | "sent" | "failed";
  deliveryId?: string;
  duplicate?: boolean;
};

type DispatchInput = {
  event: NotificationEvent;
  to: string;
  message: string;
  context: string;
  idempotencyKey: string;
  bookingId?: string;
};

function maskRecipient(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length > 4 ? `${"*".repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}` : "****";
}

function configured(): boolean {
  return process.env.WHATSAPP_ENABLED === "true" && Boolean(process.env.WHATSAPP_API_URL?.trim()) && Boolean(process.env.WHATSAPP_API_TOKEN?.trim());
}

export async function dispatchWhatsAppNotification(input: DispatchInput): Promise<NotificationDispatchResult> {
  const initialStatus = configured() ? "PENDING" : "NOT_CONFIGURED";
  const delivery = await prisma.notificationDelivery.upsert({
    where: { idempotencyKey: input.idempotencyKey },
    create: {
      id: randomUUID(), event: input.event, recipient: input.to, recipientMasked: maskRecipient(input.to),
      message: input.message, context: input.context, idempotencyKey: input.idempotencyKey,
      status: initialStatus, bookingId: input.bookingId,
      lastError: initialStatus === "NOT_CONFIGURED" ? "WhatsApp ainda nao configurado" : null,
    },
    update: {},
  });
  if (delivery.status === "SENT") return { status: "sent", deliveryId: delivery.id, duplicate: true };
  if (!configured()) return { status: "not_configured", deliveryId: delivery.id, duplicate: delivery.attempts > 0 };

  const claimed = await prisma.notificationDelivery.updateMany({
    where: { id: delivery.id, status: { in: ["PENDING", "FAILED", "NOT_CONFIGURED"] } },
    data: { status: "SENDING", attempts: { increment: 1 }, lastError: null },
  });
  if (!claimed.count) return { status: "pending", deliveryId: delivery.id, duplicate: true };
  try {
    const { sendWhatsAppMessage } = await import("@/lib/whatsapp");
    const sent = await sendWhatsAppMessage({ to: input.to, message: input.message, context: input.context });
    await prisma.notificationDelivery.update({
      where: { id: delivery.id },
      data: sent ? { status: "SENT", sentAt: new Date(), nextRetryAt: null } : { status: "FAILED", lastError: "Provider nao confirmou o envio", nextRetryAt: new Date(Date.now() + 5 * 60_000) },
    });
    return { status: sent ? "sent" : "failed", deliveryId: delivery.id };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Falha desconhecida no provider";
    await prisma.notificationDelivery.update({ where: { id: delivery.id }, data: { status: "FAILED", lastError: message, nextRetryAt: new Date(Date.now() + 5 * 60_000) } });
    return { status: "failed", deliveryId: delivery.id };
  }
}

export async function retryPendingNotifications(limit = 25): Promise<NotificationDispatchResult[]> {
  if (!configured()) return [];
  const now = new Date();
  await prisma.notificationDelivery.updateMany({
    where: { status: "SENDING", updatedAt: { lt: new Date(now.getTime() - 2 * 60_000) } },
    data: { status: "FAILED", lastError: "Envio interrompido antes da confirmacao", nextRetryAt: now },
  });
  const pending = await prisma.notificationDelivery.findMany({
    where: {
      status: { in: ["PENDING", "FAILED", "NOT_CONFIGURED"] },
      attempts: { lt: 10 },
      OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
    },
    orderBy: { createdAt: "asc" }, take: Math.min(100, Math.max(1, limit)),
  });
  const results: NotificationDispatchResult[] = [];
  for (const item of pending) results.push(await dispatchWhatsAppNotification({ event: item.event, to: item.recipient, message: item.message, context: item.context, idempotencyKey: item.idempotencyKey, bookingId: item.bookingId ?? undefined }));
  return results;
}
