import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hashClientPassword, normalizeClientPhone } from "@/lib/auth/client-store";
import { registerRateLimitEvent, sha256 } from "@/lib/security";

const RESET_TOKEN_TTL_MINUTES = 30;
const RESET_RATE_LIMIT_WINDOW_MINUTES = 60;
const RESET_RATE_LIMIT_MAX_ATTEMPTS = 5;

export const PASSWORD_RESET_GENERIC_MESSAGE =
  "Se existir uma conta com os dados informados, enviaremos as instrucoes de recuperacao.";

export type PasswordResetTokenStatus = "valid" | "invalid" | "expired" | "used";

function logPasswordResetEvent(event: string, details: Record<string, string | number | boolean | null | undefined> = {}) {
  console.info("[password-reset]", JSON.stringify({ event, ...details }));
}

function createRawResetToken(): string {
  return randomBytes(32).toString("base64url");
}

function normalizePhoneForLookup(identifier: string): string {
  const digits = normalizeClientPhone(identifier);
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
    return digits.slice(2);
  }
  return digits;
}

function normalizeIdentifier(identifier: string): { type: "phone" | "invalid"; value: string } {
  const trimmed = identifier.trim();
  if (!trimmed) {
    return { type: "invalid", value: "" };
  }

  const phone = normalizePhoneForLookup(trimmed);
  if (phone.length >= 10 && phone.length <= 11) {
    return { type: "phone", value: phone };
  }

  return { type: "invalid", value: trimmed.toLowerCase().slice(0, 160) };
}

function getAppBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL;
  if (configured) {
    return configured.replace(/\/$/, "");
  }

  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }

  return "http://localhost:3000";
}

export function buildPasswordResetLink(rawToken: string): string {
  return `${getAppBaseUrl()}/redefinir-senha?token=${encodeURIComponent(rawToken)}`;
}

export function buildPasswordResetWhatsAppMessage(clientName: string, resetLink: string): string {
  return [
    `Ola, ${clientName}!`,
    "",
    "Recebemos uma solicitacao para redefinir sua senha de acesso ao sistema Alfa Cabelos.",
    "",
    "Para criar uma nova senha, clique no link abaixo:",
    resetLink,
    "",
    `Este link e valido por ${RESET_TOKEN_TTL_MINUTES} minutos.`,
    "",
    "Se voce nao solicitou essa alteracao, ignore esta mensagem.",
  ].join("\n");
}

async function cleanupOldResetRows() {
  const tokenCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

  await prisma.passwordResetToken.deleteMany({
    where: {
      expiresAt: { lt: tokenCutoff },
      usedAt: { not: null },
    },
  });
}

export async function registerPasswordResetAttempt(identifier: string): Promise<{ blocked: boolean }> {
  const normalized = normalizeIdentifier(identifier);

  await cleanupOldResetRows();

  logPasswordResetEvent("request_received", {
    identifierHash: sha256(`${normalized.type}:${normalized.value}`),
    identifierType: normalized.type,
  });

  const result = await registerRateLimitEvent({
    scope: "client-password-reset",
    identifier: `${normalized.type}:${normalized.value}`,
    windowSeconds: RESET_RATE_LIMIT_WINDOW_MINUTES * 60,
    maxAttempts: RESET_RATE_LIMIT_MAX_ATTEMPTS,
  });

  if (result.blocked) {
    logPasswordResetEvent("request_rate_limited", {
      identifierHash: sha256(`${normalized.type}:${normalized.value}`),
      retryAfterSeconds: result.retryAfterSeconds,
    });
  }

  return { blocked: result.blocked };
}

export async function createPasswordResetForIdentifier(identifier: string): Promise<
  | {
      clientName: string;
      clientPhone: string;
      resetLink: string;
    }
  | undefined
> {
  const normalized = normalizeIdentifier(identifier);
  if (normalized.type !== "phone") {
    logPasswordResetEvent("request_identifier_invalid");
    return undefined;
  }

  const client = await prisma.client.findUnique({
    where: { phoneNormalized: normalized.value },
    select: { id: true, name: true, phone: true },
  });

  if (!client) {
    logPasswordResetEvent("client_not_found", {
      identifierHash: sha256(`phone:${normalized.value}`),
    });
    return undefined;
  }

  logPasswordResetEvent("client_found", {
    clientId: client.id,
    identifierHash: sha256(`phone:${normalized.value}`),
  });

  const rawToken = createRawResetToken();
  const tokenHash = sha256(rawToken);
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000);

  await prisma.$transaction(async (tx) => {
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
  });

  logPasswordResetEvent("token_saved", {
    clientId: client.id,
    expiresInMinutes: RESET_TOKEN_TTL_MINUTES,
  });

  return {
    clientName: client.name,
    clientPhone: client.phone,
    resetLink: buildPasswordResetLink(rawToken),
  };
}

export async function validatePasswordResetToken(rawToken: string): Promise<{ valid: boolean; status: PasswordResetTokenStatus }> {
  if (!rawToken || rawToken.length > 256) {
    logPasswordResetEvent("token_validation_invalid");
    return { valid: false, status: "invalid" };
  }

  const tokenHash = sha256(rawToken);
  const token = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    select: { expiresAt: true, usedAt: true },
  });

  if (!token) {
    logPasswordResetEvent("token_validation_invalid");
    return { valid: false, status: "invalid" };
  }

  if (token.usedAt) {
    logPasswordResetEvent("token_validation_used");
    return { valid: false, status: "used" };
  }

  if (token.expiresAt <= new Date()) {
    logPasswordResetEvent("token_validation_expired");
    return { valid: false, status: "expired" };
  }

  logPasswordResetEvent("token_validation_valid");
  return { valid: true, status: "valid" };
}

export async function resetClientPasswordWithToken(rawToken: string, password: string): Promise<boolean> {
  if (!rawToken || rawToken.length > 256) {
    return false;
  }

  const tokenHash = sha256(rawToken);
  const passwordHash = await hashClientPassword(password);
  const now = new Date();

  const updated = await prisma.$transaction(
    async (tx) => {
      const token = await tx.passwordResetToken.findUnique({
        where: { tokenHash },
        select: { id: true, clientId: true, expiresAt: true, usedAt: true },
      });

      if (!token || token.usedAt || token.expiresAt <= now) {
        logPasswordResetEvent("reset_rejected");
        return false;
      }

      await tx.client.update({
        where: { id: token.clientId },
        data: {
          passwordHash,
          hasPassword: true,
          status: "ACTIVE",
        },
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

      logPasswordResetEvent("password_reset_completed", {
        clientId: token.clientId,
      });

      return true;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );

  return updated;
}
