import { Prisma, type NotificationDelivery } from "@prisma/client";

export const DEFAULT_NOTIFICATION_MAX_ATTEMPTS = 8;
export const STALE_NOTIFICATION_LOCK_MS = 5 * 60_000;

export type DeliveryClaimState = Pick<NotificationDelivery,
  "status" | "attempts" | "eligibleAt" | "nextRetryAt" | "lockedAt" | "lockedBy"
>;

export function notificationMaxAttempts(rawValue = Number(process.env.NOTIFICATION_MAX_ATTEMPTS)): number {
  if (!Number.isFinite(rawValue)) return DEFAULT_NOTIFICATION_MAX_ATTEMPTS;
  return Math.min(20, Math.max(1, Math.trunc(rawValue)));
}

export function notificationStaleBefore(now: Date): Date {
  return new Date(now.getTime() - STALE_NOTIFICATION_LOCK_MS);
}

export function notificationClaimEligibilitySql(input: {
  now: Date;
  maxAttempts: number;
  staleBefore: Date;
}): Prisma.Sql {
  return Prisma.sql`
    "status" IN ('PENDING', 'RETRY')
    AND "eligibleAt" IS NOT NULL
    AND "eligibleAt" <= ${input.now}
    AND "attempts" < ${input.maxAttempts}
    AND ("nextRetryAt" IS NULL OR "nextRetryAt" <= ${input.now})
    AND (
      ("lockedAt" IS NULL AND "lockedBy" IS NULL)
      OR "lockedAt" < ${input.staleBefore}
    )
  `;
}

export function isDeliveryEligibleForClaim(
  delivery: DeliveryClaimState,
  now: Date,
  maxAttempts: number,
): boolean {
  if (delivery.status !== "PENDING" && delivery.status !== "RETRY") return false;
  if (!delivery.eligibleAt || delivery.eligibleAt > now) return false;
  if (delivery.attempts >= maxAttempts) return false;
  if (delivery.nextRetryAt && delivery.nextRetryAt > now) return false;

  const staleBefore = notificationStaleBefore(now);
  return (
    delivery.lockedAt === null && delivery.lockedBy === null
  ) || (
    delivery.lockedAt !== null && delivery.lockedAt < staleBefore
  );
}
