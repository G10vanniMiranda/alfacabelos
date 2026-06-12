import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hashClientPassword, normalizeClientPhone } from "@/lib/auth/client-store";
import { registerRateLimitEvent, sha256 } from "@/lib/security";

const RESET_TOKEN_TTL_MINUTES = 60;
const RESET_RATE_LIMIT_WINDOW_MINUTES = 60;
const RESET_RATE_LIMIT_MAX_ATTEMPTS = 5;

export const PASSWORD_RESET_GENERIC_MESSAGE =
  "Se os dados estiverem cadastrados, enviaremos instrucoes para recuperar sua senha.";

function createRawResetToken(): string {
  return randomBytes(32).toString("base64url");
}

function normalizeIdentifier(identifier: string): { type: "phone" | "email" | "invalid"; value: string } {
  const trimmed = identifier.trim();
  if (!trimmed) {
    return { type: "invalid", value: "" };
  }

  if (trimmed.includes("@")) {
    return { type: "email", value: trimmed.toLowerCase() };
  }

  const phone = normalizeClientPhone(trimmed);
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
    "Este link e valido por 1 hora.",
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

  const result = await registerRateLimitEvent({
    scope: "client-password-reset",
    identifier: `${normalized.type}:${normalized.value}`,
    windowSeconds: RESET_RATE_LIMIT_WINDOW_MINUTES * 60,
    maxAttempts: RESET_RATE_LIMIT_MAX_ATTEMPTS,
  });

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
    return undefined;
  }

  const client = await prisma.client.findUnique({
    where: { phoneNormalized: normalized.value },
    select: { id: true, name: true, phone: true },
  });

  if (!client) {
    return undefined;
  }

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

  return {
    clientName: client.name,
    clientPhone: client.phone,
    resetLink: buildPasswordResetLink(rawToken),
  };
}

export async function validatePasswordResetToken(rawToken: string): Promise<{ valid: boolean }> {
  if (!rawToken || rawToken.length > 256) {
    return { valid: false };
  }

  const tokenHash = sha256(rawToken);
  const token = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    select: { expiresAt: true, usedAt: true },
  });

  return { valid: Boolean(token && !token.usedAt && token.expiresAt > new Date()) };
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

      return true;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );

  return updated;
}
