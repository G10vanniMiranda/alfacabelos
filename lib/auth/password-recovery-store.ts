import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hashClientPassword } from "@/lib/auth/client-store";
import { registerPasswordResetAttempt } from "@/lib/auth/client-password-reset-store";
import { enqueueWhatsAppNotification, redactExpiredSealedMessages } from "@/lib/notifications/service";
import { whatsAppProviderName } from "@/lib/notifications/whatsapp-provider";
import { recordAuditEvent } from "@/lib/observability/audit";
import { logger } from "@/lib/observability/logger";
import { getBrazilPhoneLookupCandidates } from "@/lib/phone";
import { registerRateLimitEvent } from "@/lib/security";
import {
  deriveRecoveryKeys,
  RECOVERY_CODE_TTL_MINUTES,
  sealDeliveryPayload,
} from "@/lib/auth/password-recovery-crypto";
import type { RecoveryChallengeRecord, RecoveryDependencies, RecoveryStore } from "@/lib/auth/password-recovery";

const CHALLENGE_RETENTION_MS = 24 * 60 * 60_000;

/**
 * The only channel today is WhatsApp. It counts as available only when it can really deliver:
 * enabled, provider configured, sealing secret present and, for Meta, an approved auth template.
 */
export function resolveRecoveryChannel(env: Partial<NodeJS.ProcessEnv> = process.env): "whatsapp" | null {
  if (env.WHATSAPP_ENABLED !== "true") return null;
  if (!env.WHATSAPP_API_URL?.trim() || !env.WHATSAPP_API_TOKEN?.trim()) return null;
  if (!deriveRecoveryKeys(env.PASSWORD_RESET_SECRET)) return null;
  if (whatsAppProviderName(env) === "meta" && !env.WHATSAPP_AUTH_TEMPLATE_NAME?.trim()) return null;
  return "whatsapp";
}

export function buildRecoveryCodeMessage(code: string): string {
  return [
    `ALFA CABELOS: seu código de recuperação de senha é ${code}.`,
    `Ele vale por ${RECOVERY_CODE_TTL_MINUTES} minutos e só pode ser usado uma vez.`,
    "Não compartilhe este código com ninguém. Se você não pediu, ignore esta mensagem.",
  ].join("\n");
}

const CHALLENGE_SELECT = {
  id: true, clientId: true, codeHash: true, attempts: true, expiresAt: true,
  verifiedAt: true, consumedAt: true, invalidatedAt: true,
} as const;

export const prismaRecoveryStore: RecoveryStore = {
  async findClientByPhone(phone) {
    for (const candidate of getBrazilPhoneLookupCandidates(phone)) {
      const client = await prisma.client.findUnique({ where: { phoneNormalized: candidate }, select: { id: true, name: true, phone: true } });
      if (client) return client;
    }
    return null;
  },

  countChallengesSince(clientId, since) {
    return prisma.passwordResetChallenge.count({ where: { clientId, createdAt: { gte: since } } });
  },

  async createChallenge({ challenge, intent, now, requestId }) {
    await prisma.passwordResetChallenge.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - CHALLENGE_RETENTION_MS) } } });
    await redactExpiredSealedMessages(now);
    return prisma.$transaction(async (tx) => {
      await tx.passwordResetChallenge.updateMany({
        where: { clientId: challenge.clientId, consumedAt: null, invalidatedAt: null },
        data: { invalidatedAt: now },
      });
      await tx.passwordResetChallenge.create({ data: challenge });
      const delivery = await enqueueWhatsAppNotification(tx, intent);
      await recordAuditEvent(tx, {
        actorType: "SYSTEM", action: "client.password_recovery.requested", resourceType: "Client",
        resourceId: challenge.clientId, requestId, metadata: { channel: challenge.channel },
      });
      return { deliveryId: delivery.deliveryId! };
    });
  },

  findChallenge(handleHash): Promise<RecoveryChallengeRecord | null> {
    return prisma.passwordResetChallenge.findUnique({ where: { handleHash }, select: CHALLENGE_SELECT });
  },

  async reserveAttempt(id, now, maxAttempts) {
    // Single conditional UPDATE: concurrent guesses can never exceed maxAttempts.
    const rows = await prisma.$queryRaw<Array<{ attempts: number }>>(Prisma.sql`
      UPDATE "PasswordResetChallenge"
      SET "attempts" = "attempts" + 1
      WHERE "id" = ${id}
        AND "attempts" < ${maxAttempts}
        AND "verifiedAt" IS NULL
        AND "consumedAt" IS NULL
        AND "invalidatedAt" IS NULL
        AND "expiresAt" > ${now}
      RETURNING "attempts"
    `);
    return rows[0]?.attempts ?? null;
  },

  async markVerified(id, now, expiresAt) {
    const result = await prisma.passwordResetChallenge.updateMany({
      where: { id, verifiedAt: null, consumedAt: null, invalidatedAt: null, expiresAt: { gt: now } },
      data: { verifiedAt: now, expiresAt },
    });
    return result.count === 1;
  },

  async lockChallenge(id, clientId, now, requestId) {
    await prisma.$transaction(async (tx) => {
      await tx.passwordResetChallenge.updateMany({ where: { id, invalidatedAt: null }, data: { invalidatedAt: now } });
      await recordAuditEvent(tx, {
        actorType: "SYSTEM", action: "client.password_recovery.locked", resourceType: "Client", resourceId: clientId, requestId,
      });
    });
  },

  async completeReset({ challengeId, clientId, passwordHash, now, requestId }) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await prisma.$transaction(async (tx) => {
          const consumed = await tx.passwordResetChallenge.updateMany({
            where: { id: challengeId, clientId, verifiedAt: { not: null }, consumedAt: null, invalidatedAt: null, expiresAt: { gt: now } },
            data: { consumedAt: now },
          });
          if (consumed.count !== 1) return false;
          await tx.client.update({ where: { id: clientId }, data: { passwordHash, hasPassword: true, status: "ACTIVE" } });
          await tx.clientSession.deleteMany({ where: { clientId } });
          await tx.passwordResetChallenge.updateMany({
            where: { clientId, id: { not: challengeId }, consumedAt: null, invalidatedAt: null },
            data: { invalidatedAt: now },
          });
          // Links issued by the previous flow die with the old password.
          await tx.passwordResetToken.updateMany({ where: { clientId, usedAt: null }, data: { usedAt: now } });
          await recordAuditEvent(tx, {
            actorType: "CLIENT", actorId: clientId, action: "client.password_recovery.completed",
            resourceType: "Client", resourceId: clientId, requestId, metadata: { sessionsRevoked: true },
          });
          return true;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") || attempt === 1) throw error;
      }
    }
    return false;
  },
};

export function createRecoveryDependencies(overrides: Partial<RecoveryDependencies> = {}): RecoveryDependencies {
  return {
    store: prismaRecoveryStore,
    keys: deriveRecoveryKeys(),
    channel: resolveRecoveryChannel(),
    buildIntent: ({ challengeId, client, code, keys }) => {
      const idempotencyKey = `password-reset-code:${challengeId}`;
      return {
        event: "PASSWORD_RESET",
        to: client.phone,
        // Sealed: the plaintext code never lands in NotificationDelivery.message.
        message: sealDeliveryPayload(keys, { text: buildRecoveryCodeMessage(code), otp: code }, idempotencyKey),
        context: "recuperacao-senha-codigo",
        idempotencyKey,
      };
    },
    limitRequest: registerPasswordResetAttempt,
    rateLimit: registerRateLimitEvent,
    hashPassword: hashClientPassword,
    now: () => new Date(),
    log: (event, fields) => logger.info(event, fields),
    ...overrides,
  };
}
