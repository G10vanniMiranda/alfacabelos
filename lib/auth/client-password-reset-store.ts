import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hashClientPassword } from "@/lib/auth/client-store";
import { registerRateLimitEvent, sha256 } from "@/lib/security";
import { buildAppUrl } from "@/lib/app-url";
import { enqueueWhatsAppNotification } from "@/lib/notifications/service";
import { logger } from "@/lib/observability/logger";
import { getBrazilPhoneLookupCandidates, normalizeBrazilPhoneNational } from "@/lib/phone";
import {
  createPasswordResetToken,
  evaluatePasswordResetToken,
  hashPasswordResetToken,
  PASSWORD_RESET_TOKEN_TTL_MINUTES,
  type PasswordResetTokenStatus,
} from "@/lib/auth/password-reset-security";

const RESET_RATE_LIMIT_WINDOW_MINUTES = 60;
const RESET_RATE_LIMIT_MAX_ATTEMPTS = 5;
export const PASSWORD_RESET_RESEND_COOLDOWN_SECONDS = 60;

export const PASSWORD_RESET_GENERIC_MESSAGE =
  "Se existir uma conta vinculada aos dados informados, enviaremos as instruções de recuperação.";

function logPasswordResetEvent(event: string, details: Record<string, string | number | boolean | null | undefined> = {}) {
  logger.info(`password_reset.${event}`, details);
}

function normalizeIdentifier(identifier: string): { type: "phone" | "invalid"; value: string } {
  const trimmed = identifier.trim();
  if (!trimmed) {
    return { type: "invalid", value: "" };
  }

  const phone = normalizeBrazilPhoneNational(trimmed);
  if (phone) {
    return { type: "phone", value: phone };
  }

  return { type: "invalid", value: trimmed.toLowerCase().slice(0, 160) };
}

export function buildPasswordResetLink(rawToken: string): string {
  const link = buildAppUrl(`/redefinir-senha?token=${encodeURIComponent(rawToken)}`);
  if (!link) throw new Error("Password reset application URL is not configured");
  return link;
}

export function buildPasswordResetWhatsAppMessage(clientName: string, resetLink: string): string {
  return [
    `Olá, ${clientName}!`,
    "",
    "Recebemos uma solicitação para redefinir sua senha de acesso ao sistema Alfa Cabelos.",
    "",
    "Para criar uma nova senha, clique no link abaixo:",
    resetLink,
    "",
    `Este link é válido por ${PASSWORD_RESET_TOKEN_TTL_MINUTES} minutos.`,
    "",
    "Se você não solicitou essa alteração, ignore esta mensagem.",
  ].join("\n");
}

async function cleanupOldResetRows() {
  const tokenCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

  await prisma.passwordResetToken.deleteMany({
    where: {
      expiresAt: { lt: tokenCutoff },
    },
  });
}

export async function registerPasswordResetAttempt(
  identifier: string,
  clientIp = "unknown",
  requestId?: string,
): Promise<{ blocked: boolean; retryAfterSeconds: number }> {
  const normalized = normalizeIdentifier(identifier);
  const subject = `${normalized.type}:${normalized.value}`;

  await cleanupOldResetRows();

  logPasswordResetEvent("request_received", {
    requestId,
    identifierHash: sha256(subject),
    identifierType: normalized.type,
  });

  const cooldown = await registerRateLimitEvent({
    scope: "client-password-reset-cooldown",
    identifier: subject,
    windowSeconds: PASSWORD_RESET_RESEND_COOLDOWN_SECONDS,
    maxAttempts: 1,
  });
  const pairLimit = cooldown.blocked ? cooldown : await registerRateLimitEvent({
    scope: "client-password-reset-pair",
    identifier: `${clientIp}:${subject}`,
    windowSeconds: RESET_RATE_LIMIT_WINDOW_MINUTES * 60,
    maxAttempts: RESET_RATE_LIMIT_MAX_ATTEMPTS,
  });
  const ipLimit = pairLimit.blocked || clientIp === "unknown" ? pairLimit : await registerRateLimitEvent({
    scope: "client-password-reset-ip",
    identifier: clientIp,
    windowSeconds: RESET_RATE_LIMIT_WINDOW_MINUTES * 60,
    maxAttempts: 20,
  });
  const result = cooldown.blocked ? cooldown : pairLimit.blocked ? pairLimit : ipLimit;

  if (result.blocked) {
    logPasswordResetEvent("request_rate_limited", {
      requestId,
      identifierHash: sha256(subject),
      retryAfterSeconds: result.retryAfterSeconds,
    });
  }

  return result;
}

export async function createPasswordResetForIdentifier(identifier: string, requestId?: string): Promise<
  | {
      clientName: string;
      clientPhone: string;
      resetLink: string;
    }
  | undefined
> {
  const normalized = normalizeIdentifier(identifier);
  if (normalized.type !== "phone") {
    logPasswordResetEvent("request_identifier_invalid", { requestId });
    return undefined;
  }

  let client = null;
  for (const candidate of getBrazilPhoneLookupCandidates(normalized.value)) {
    client = await prisma.client.findUnique({
      where: { phoneNormalized: candidate },
      select: { id: true, name: true, phone: true },
    });
    if (client) break;
  }

  if (!client) {
    logPasswordResetEvent("client_not_found", {
      requestId,
      identifierHash: sha256(`phone:${normalized.value}`),
    });
    return undefined;
  }

  logPasswordResetEvent("client_found", {
    requestId,
    clientId: client.id,
    identifierHash: sha256(`phone:${normalized.value}`),
  });

  const { rawToken, tokenHash, expiresAt } = createPasswordResetToken();
  const resetLink = buildPasswordResetLink(rawToken);

  const delivery = await prisma.$transaction(async (tx) => {
    await tx.passwordResetToken.updateMany({
      where: {
        clientId: client.id,
        usedAt: null,
      },
      data: { usedAt: new Date() },
    });

    await tx.passwordResetToken.create({
      data: {
        clientId: client.id,
        tokenHash,
        expiresAt,
      },
    });
    return enqueueWhatsAppNotification(tx, {
      event: "PASSWORD_RESET",
      to: client.phone,
      message: buildPasswordResetWhatsAppMessage(client.name, resetLink),
      context: "recuperacao-senha-cliente",
      idempotencyKey: `password-reset:${tokenHash}`,
      requestId,
    });
  });

  logPasswordResetEvent("token_saved", {
    requestId,
    clientId: client.id,
    expiresInMinutes: PASSWORD_RESET_TOKEN_TTL_MINUTES,
  });
  logPasswordResetEvent("delivery_requested", {
    requestId,
    clientId: client.id,
    notificationId: delivery.deliveryId,
    deliveryStatus: delivery.status,
  });

  return {
    clientName: client.name,
    clientPhone: client.phone,
    resetLink,
  };
}

export async function validatePasswordResetToken(rawToken: string, requestId?: string): Promise<{ valid: boolean; status: PasswordResetTokenStatus }> {
  if (!rawToken || rawToken.length > 256) {
    logPasswordResetEvent("token_validation_invalid", { requestId });
    return { valid: false, status: "invalid" };
  }

  const tokenHash = hashPasswordResetToken(rawToken);
  const token = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    select: { expiresAt: true, usedAt: true },
  });

  const status = evaluatePasswordResetToken(token);
  logPasswordResetEvent(`token_validation_${status}`, { requestId });
  return { valid: status === "valid", status };
}

export async function resetClientPasswordWithToken(rawToken: string, password: string, requestId?: string): Promise<boolean> {
  if (!rawToken || rawToken.length > 256) {
    return false;
  }

  const tokenHash = hashPasswordResetToken(rawToken);
  const passwordHash = await hashClientPassword(password);
  const now = new Date();

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const updatedClientId = await prisma.$transaction(
        async (tx) => {
      const token = await tx.passwordResetToken.findUnique({
        where: { tokenHash },
        select: { id: true, clientId: true, expiresAt: true, usedAt: true },
      });

      if (evaluatePasswordResetToken(token, now) !== "valid" || !token) {
        return null;
      }

      await tx.client.update({
        where: { id: token.clientId },
        data: {
          passwordHash,
          hasPassword: true,
          status: "ACTIVE",
        },
      });

      await tx.clientSession.deleteMany({
        where: { clientId: token.clientId },
      });

      await tx.passwordResetToken.update({
        where: { id: token.id },
        data: { usedAt: now },
      });

      await tx.passwordResetToken.updateMany({
        where: {
          clientId: token.clientId,
          id: { not: token.id },
          usedAt: null,
        },
        data: { usedAt: now },
      });

      return token.clientId;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      if (!updatedClientId) {
        logPasswordResetEvent("reset_rejected", { requestId });
        return false;
      }
      logPasswordResetEvent("password_reset_completed", { requestId, clientId: updatedClientId });
      return true;
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") || attempt === 1) throw error;
    }
  }
  return false;
}
