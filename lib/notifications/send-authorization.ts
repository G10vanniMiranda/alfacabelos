import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { checkCriticalConfiguration } from "@/lib/observability/health";
import { logger } from "@/lib/observability/logger";
import { readCanaryConfig, type CanaryConfig } from "@/lib/notifications/canary-config";

type Env = Partial<Record<string, string | undefined>>;

export type SendPolicy =
  | { allowed: true; mode: "production" }
  | { allowed: true; mode: "canary"; canary: CanaryConfig }
  | { allowed: false; reason: string };

export type SendDecision =
  | { allowed: true; mode: "production" }
  | { allowed: true; mode: "canary"; roundId: string; slot: number }
  | { allowed: false; reason: string; retryable: boolean };

/**
 * Pure part of the send policy. Fail-closed: anything not explicitly allowed is blocked.
 * - production: WhatsApp enabled, healthy configuration, explicitly identified instance, no canary settings;
 * - homologation: only through an active canary, and only to its allowlist;
 * - any other environment: never.
 */
export function evaluateSendPolicy(input: { to: string; provider: string; env: Env; now: Date }): SendPolicy {
  const { env, now } = input;
  if (env.WHATSAPP_ENABLED !== "true") return { allowed: false, reason: "whatsapp_disabled" };
  const appEnv = env.APP_ENV?.trim().toLowerCase();
  if (appEnv !== "production" && appEnv !== "homologation") return { allowed: false, reason: "environment_not_allowed" };

  const configuration = checkCriticalConfiguration(env, now);
  if (configuration.status !== "healthy") return { allowed: false, reason: `configuration:${configuration.issues.join(",")}`.slice(0, 200) };

  const instanceId = env.WHATSAPP_INSTANCE_ID?.trim() ?? "";
  const canary = readCanaryConfig(env, now);

  if (appEnv === "production") {
    if (canary.status !== "disabled") return { allowed: false, reason: "canary_in_production" };
    if (input.provider === "evolution" && (!instanceId || instanceId !== env.PRODUCTION_EVOLUTION_INSTANCE_ID?.trim())) {
      return { allowed: false, reason: "instance_not_authorized" };
    }
    return { allowed: true, mode: "production" };
  }

  if (canary.status === "disabled") return { allowed: false, reason: "canary_disabled" };
  if (canary.status === "invalid") return { allowed: false, reason: canary.reason };
  if (canary.status === "expired") return { allowed: false, reason: "canary_expired" };
  if (!instanceId || canary.config.instanceId !== instanceId) return { allowed: false, reason: "canary_instance_mismatch" };
  if (!canary.config.recipients.has(input.to)) return { allowed: false, reason: "recipient_not_allowlisted" };
  return { allowed: true, mode: "canary", canary: canary.config };
}

/**
 * Reserves one message of the round's budget. The counter lives in the database, so it is shared by
 * every worker and survives restarts; the conditional upsert is atomic under concurrency.
 * Returns the slot number, or null when the budget is exhausted.
 */
export async function reserveCanarySlot(config: CanaryConfig): Promise<number | null> {
  const key = `whatsapp-canary:${config.roundId}`;
  const metadata = JSON.stringify({ maxMessages: config.maxMessages, expiresAt: config.expiresAt.toISOString() });
  const rows = await prisma.$queryRaw<Array<{ used: number }>>(Prisma.sql`
    INSERT INTO "OperationalHeartbeat" ("worker", "status", "lastRunAt", "processedCount", "metadata", "updatedAt")
    VALUES (${key}, 'canary', now(), 1, ${metadata}::jsonb, now())
    ON CONFLICT ("worker") DO UPDATE
      SET "processedCount" = "OperationalHeartbeat"."processedCount" + 1, "lastRunAt" = now(), "updatedAt" = now()
      WHERE "OperationalHeartbeat"."processedCount" < ${config.maxMessages}
    RETURNING "processedCount" AS used
  `);
  return rows[0]?.used ?? null;
}

/** The single gate every provider call goes through, evaluated right before the HTTP request. */
export async function authorizeWhatsAppSend(
  input: { to: string; provider: string; context: string },
  deps: { env?: Env; now?: Date; reserve?: (config: CanaryConfig) => Promise<number | null> } = {},
): Promise<SendDecision> {
  const now = deps.now ?? new Date();
  const block = (reason: string, retryable: boolean): SendDecision => {
    logger.warn("whatsapp.send_blocked", { reason, retryable, recipient: input.to, context: input.context });
    return { allowed: false, reason, retryable };
  };
  const policy = evaluateSendPolicy({ to: input.to, provider: input.provider, env: deps.env ?? process.env, now });
  if (!policy.allowed) return block(policy.reason, false);
  if (policy.mode === "production") return policy;
  try {
    const slot = await (deps.reserve ?? reserveCanarySlot)(policy.canary);
    if (slot === null) return block("canary_limit_reached", false);
    logger.info("whatsapp.canary_slot_reserved", {
      roundId: policy.canary.roundId, slot, maxMessages: policy.canary.maxMessages,
      recipient: input.to, context: input.context,
    });
    return { allowed: true, mode: "canary", roundId: policy.canary.roundId, slot };
  } catch {
    // The budget cannot be verified: nothing is sent; the outbox retry path tries again later.
    return block("canary_authorization_unavailable", true);
  }
}
