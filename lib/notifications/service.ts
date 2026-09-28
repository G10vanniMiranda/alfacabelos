import { randomUUID } from "node:crypto";
import { NotificationEvent, Prisma, type NotificationDelivery } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendWhatsAppOnce, type WhatsAppSendResult } from "@/lib/notifications/whatsapp-provider";
import { logger } from "@/lib/observability/logger";
import { recordWorkerHeartbeat } from "@/lib/observability/health";
import {
  notificationClaimEligibilitySql,
  notificationMaxAttempts,
  notificationStaleBefore,
  type DeliveryClaimState,
} from "@/lib/notifications/claim-policy";

export { isDeliveryEligibleForClaim } from "@/lib/notifications/claim-policy";

export type NotificationIntentInput = {
  event: NotificationEvent;
  to: string;
  message: string;
  context: string;
  idempotencyKey: string;
  bookingId?: string;
  seriesId?: string;
  requestId?: string;
};

export type NotificationDispatchResult = {
  status: "pending" | "sent" | "retry" | "dead";
  deliveryId?: string;
  duplicate?: boolean;
};

export type OutboxMetrics = {
  pending: number;
  processing: number;
  retry: number;
  sent: number;
  dead: number;
  backlog: number;
  eligibleNow: number;
  oldestReadyAt: string | null;
  successRate: number | null;
  retryAttempts: number;
};

export type WorkerSummary = {
  workerId: string;
  claimed: number;
  sent: number;
  retry: number;
  dead: number;
  durationMs: number;
  metrics: OutboxMetrics;
};

type DbClient = Prisma.TransactionClient | typeof prisma;
type ClaimedDelivery = Pick<NotificationDelivery,
  "id" | "event" | "recipient" | "recipientMasked" | "message" | "context" |
  "idempotencyKey" | "attempts" | "bookingId" | "seriesId" | "requestId" | "eligibleAt" | "createdAt"
>;

export type WorkerOptions = {
  batchSize?: number;
  concurrency?: number;
  workerId?: string;
  now?: Date;
  random?: () => number;
  send?: (input: { to: string; message: string; context: string; idempotencyKey: string }) => Promise<WhatsAppSendResult>;
};

const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_CONCURRENCY = 5;
const RETRY_BASE_MS = 30_000;
const RETRY_CAP_MS = 60 * 60_000;

function boundedInteger(value: number | undefined, fallback: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(1, Math.trunc(value!)));
}

export function isStaleProcessingLockRecoverable(
  delivery: DeliveryClaimState,
  now: Date,
  maxAttempts: number,
): boolean {
  if (delivery.status !== "PROCESSING") return false;
  if (!delivery.eligibleAt || delivery.eligibleAt > now) return false;
  if (delivery.attempts >= maxAttempts) return false;
  const staleBefore = notificationStaleBefore(now);
  return delivery.lockedAt === null || delivery.lockedAt < staleBefore;
}

export function maskRecipient(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length > 4 ? `${"*".repeat(digits.length - 4)}${digits.slice(-4)}` : "****";
}

export function computeRetryDelayMs(attempt: number, random = Math.random): number {
  const exponential = Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1));
  return Math.min(RETRY_CAP_MS, Math.round(exponential + exponential * 0.25 * Math.max(0, Math.min(1, random()))));
}

export async function enqueueWhatsAppNotification(
  db: DbClient,
  input: NotificationIntentInput,
): Promise<NotificationDispatchResult> {
  const inserted = await db.notificationDelivery.createMany({
    data: [{
      id: randomUUID(),
      event: input.event,
      recipient: input.to,
      recipientMasked: maskRecipient(input.to),
      message: input.message,
      context: input.context,
      idempotencyKey: input.idempotencyKey,
      status: "PENDING",
      eligibleAt: new Date(),
      bookingId: input.bookingId,
      seriesId: input.seriesId,
      requestId: input.requestId,
    }],
    skipDuplicates: true,
  });
  const delivery = await db.notificationDelivery.findUniqueOrThrow({
    where: { idempotencyKey: input.idempotencyKey },
    select: { id: true, status: true },
  });
  return {
    status: delivery.status === "SENT" ? "sent" : delivery.status === "DEAD" ? "dead" : delivery.status === "RETRY" ? "retry" : "pending",
    deliveryId: delivery.id,
    duplicate: inserted.count === 0,
  };
}

export async function enqueueWhatsAppNotifications(
  db: DbClient,
  inputs: NotificationIntentInput[],
): Promise<number> {
  if (!inputs.length) return 0;
  const result = await db.notificationDelivery.createMany({
    data: inputs.map((input) => ({
      id: randomUUID(),
      event: input.event,
      recipient: input.to,
      recipientMasked: maskRecipient(input.to),
      message: input.message,
      context: input.context,
      idempotencyKey: input.idempotencyKey,
      status: "PENDING" as const,
      eligibleAt: new Date(),
      bookingId: input.bookingId,
      seriesId: input.seriesId,
      requestId: input.requestId,
    })),
    skipDuplicates: true,
  });
  return result.count;
}

/** Compatibility wrapper. It only persists an intent; it never calls the provider. */
export async function dispatchWhatsAppNotification(input: NotificationIntentInput): Promise<NotificationDispatchResult> {
  return enqueueWhatsAppNotification(prisma, input);
}

export async function claimNotificationBatch(input: {
  workerId: string;
  batchSize: number;
  now?: Date;
}): Promise<ClaimedDelivery[]> {
  const now = input.now ?? new Date();
  const staleBefore = notificationStaleBefore(now);
  const limit = boundedInteger(input.batchSize, DEFAULT_BATCH_SIZE, 100);
  const maxAttempts = notificationMaxAttempts();
  const eligibility = notificationClaimEligibilitySql({ now, maxAttempts, staleBefore });

  return prisma.$transaction(async (tx) => {
    // A crashed worker may leave a legitimate delivery in PROCESSING. Recovery
    // only restores it to RETRY; the regular eligibility predicate below still
    // controls whether it can be claimed.
    await tx.$executeRaw(Prisma.sql`
      UPDATE "NotificationDelivery"
      SET "status" = 'RETRY',
          "nextRetryAt" = ${now},
          "lockedAt" = NULL,
          "lockedBy" = NULL,
          "updatedAt" = ${now}
      WHERE "status" = 'PROCESSING'
        AND "eligibleAt" IS NOT NULL
        AND "eligibleAt" <= ${now}
        AND "attempts" < ${maxAttempts}
        AND ("lockedAt" IS NULL OR "lockedAt" < ${staleBefore})
    `);

    return tx.$queryRaw<ClaimedDelivery[]>(Prisma.sql`
      WITH candidates AS (
        SELECT "id"
        FROM "NotificationDelivery"
        WHERE ${eligibility}
        ORDER BY "createdAt" ASC, "id" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      )
      UPDATE "NotificationDelivery" AS delivery
      SET "status" = 'PROCESSING',
          "attempts" = delivery."attempts" + 1,
          "lockedAt" = ${now},
          "lockedBy" = ${input.workerId},
          "lastError" = NULL,
          "errorCategory" = NULL,
          "updatedAt" = ${now}
      FROM candidates
      WHERE delivery."id" = candidates."id"
      RETURNING delivery."id", delivery."event", delivery."recipient",
        delivery."recipientMasked", delivery."message", delivery."context",
        delivery."idempotencyKey", delivery."attempts", delivery."bookingId",
        delivery."seriesId", delivery."requestId", delivery."eligibleAt", delivery."createdAt"
    `);
  });
}

async function settleDelivery(
  item: ClaimedDelivery,
  workerId: string,
  result: WhatsAppSendResult,
  now: Date,
  random: () => number,
): Promise<"sent" | "retry" | "dead"> {
  if (result.ok) {
    await prisma.notificationDelivery.updateMany({
      where: { id: item.id, status: "PROCESSING", lockedBy: workerId },
      data: {
        status: "SENT", sentAt: now, processedAt: now, eligibleAt: null, nextRetryAt: null,
        lockedAt: null, lockedBy: null, providerMessageId: result.providerMessageId ?? null,
      },
    });
    return "sent";
  }

  const maxAttempts = notificationMaxAttempts();
  const shouldRetry = result.retryable && item.attempts < maxAttempts;
  await prisma.notificationDelivery.updateMany({
    where: { id: item.id, status: "PROCESSING", lockedBy: workerId },
    data: {
      status: shouldRetry ? "RETRY" : "DEAD",
      lastError: result.error.slice(0, 500),
      errorCategory: result.category,
      eligibleAt: shouldRetry ? item.eligibleAt : null,
      nextRetryAt: shouldRetry ? new Date(now.getTime() + computeRetryDelayMs(item.attempts, random)) : null,
      processedAt: shouldRetry ? null : now,
      lockedAt: null,
      lockedBy: null,
    },
  });
  return shouldRetry ? "retry" : "dead";
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function consume() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, consume));
  return results;
}

export async function getOutboxMetrics(now = new Date()): Promise<OutboxMetrics> {
  const eligibility = notificationClaimEligibilitySql({
    now,
    maxAttempts: notificationMaxAttempts(),
    staleBefore: notificationStaleBefore(now),
  });
  const [groups, readyRows, attempts] = await Promise.all([
    prisma.notificationDelivery.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.$queryRaw<Array<{ eligibleNow: bigint; oldestReadyAt: Date | null }>>(Prisma.sql`
      SELECT
        COUNT(*)::bigint AS "eligibleNow",
        MIN("createdAt") AS "oldestReadyAt"
      FROM "NotificationDelivery"
      WHERE ${eligibility}
    `),
    prisma.notificationDelivery.aggregate({
      where: { attempts: { gt: 0 } },
      _sum: { attempts: true },
      _count: { _all: true },
    }),
  ]);
  const count = (status: string) => groups.find((row) => row.status === status)?._count._all ?? 0;
  const sent = count("SENT");
  const dead = count("DEAD");
  const pending = count("PENDING");
  const retry = count("RETRY");
  const ready = readyRows[0] ?? { eligibleNow: BigInt(0), oldestReadyAt: null };
  return {
    pending, processing: count("PROCESSING"), retry,
    sent, dead, backlog: pending + retry, eligibleNow: Number(ready.eligibleNow),
    oldestReadyAt: ready.oldestReadyAt?.toISOString() ?? null,
    successRate: sent + dead > 0 ? sent / (sent + dead) : null,
    retryAttempts: Math.max(0, (attempts._sum.attempts ?? 0) - attempts._count._all),
  };
}

export async function processNotificationBatch(options: WorkerOptions = {}): Promise<WorkerSummary> {
  const startedAt = Date.now();
  const workerId = options.workerId ?? `worker-${randomUUID()}`;
  const batchSize = boundedInteger(options.batchSize ?? Number(process.env.NOTIFICATION_BATCH_SIZE), DEFAULT_BATCH_SIZE, 100);
  const concurrency = boundedInteger(options.concurrency ?? Number(process.env.NOTIFICATION_CONCURRENCY), DEFAULT_CONCURRENCY, 10);
  const now = options.now ?? new Date();
  const random = options.random ?? Math.random;
  const send = options.send ?? sendWhatsAppOnce;
  const heartbeat = async (input: Parameters<typeof recordWorkerHeartbeat>[0]) => {
    await recordWorkerHeartbeat(input).catch((error) => logger.error("notification.worker.heartbeat_failed", { workerId, error }));
  };
  await heartbeat({ worker: "notification-outbox", status: "running", metadata: { workerId, batchSize, concurrency } });
  try {
    if (process.env.WHATSAPP_ENABLED !== "true") {
      const summary = { workerId, claimed: 0, sent: 0, retry: 0, dead: 0, durationMs: Date.now() - startedAt, metrics: await getOutboxMetrics() };
      await heartbeat({ worker: "notification-outbox", status: "success", durationMs: summary.durationMs, processedCount: 0, metadata: { disabled: true } });
      return summary;
    }

    const claimed = await claimNotificationBatch({ workerId, batchSize, now });
    const outcomes = await mapWithConcurrency(claimed, concurrency, async (item) => {
      const deliveryStartedAt = Date.now();
      const result = await send({
        to: item.recipient, message: item.message, context: item.context, idempotencyKey: item.idempotencyKey,
      }).catch((error): WhatsAppSendResult => ({
        ok: false, retryable: true, category: "unexpected",
        error: error instanceof Error ? error.message : "Unexpected provider error",
      }));
      const outcome = await settleDelivery(item, workerId, result, new Date(), random);
      const fields = {
        requestId: item.requestId, workerId, notificationId: item.id, eventType: item.event,
        bookingId: item.bookingId, attempt: item.attempts, status: outcome,
        providerStatus: result.ok ? "accepted" : result.category,
        durationMs: Date.now() - deliveryStartedAt,
      };
      if (outcome === "sent") logger.debug("notification.sent", fields);
      else logger.warn(`notification.${outcome}`, fields);
      return outcome;
    });
    const summary = {
      workerId, claimed: claimed.length,
      sent: outcomes.filter((item) => item === "sent").length,
      retry: outcomes.filter((item) => item === "retry").length,
      dead: outcomes.filter((item) => item === "dead").length,
      durationMs: Date.now() - startedAt,
      metrics: await getOutboxMetrics(),
    };
    await heartbeat({ worker: "notification-outbox", status: "success", durationMs: summary.durationMs, processedCount: summary.claimed, metadata: { sent: summary.sent, retry: summary.retry, dead: summary.dead } });
    return summary;
  } catch (error) {
    await heartbeat({ worker: "notification-outbox", status: "failure", durationMs: Date.now() - startedAt, errorCode: "worker_failed" });
    logger.error("notification.worker.failed", { workerId, durationMs: Date.now() - startedAt, error });
    throw error;
  }
}

export async function cleanupNotificationHistory(options: {
  sentRetentionDays?: number;
  deadRetentionDays?: number;
  limit?: number;
} = {}): Promise<number> {
  const sentCutoff = new Date(Date.now() - boundedInteger(options.sentRetentionDays, 90, 3650) * 86_400_000);
  const deadCutoff = new Date(Date.now() - boundedInteger(options.deadRetentionDays, 365, 3650) * 86_400_000);
  const rows = await prisma.notificationDelivery.findMany({
    where: { OR: [
      { status: "SENT", processedAt: { lt: sentCutoff } },
      { status: "DEAD", processedAt: { lt: deadCutoff } },
    ] },
    orderBy: { processedAt: "asc" }, select: { id: true }, take: boundedInteger(options.limit, 500, 2000),
  });
  if (!rows.length) return 0;
  return (await prisma.notificationDelivery.deleteMany({ where: { id: { in: rows.map((row) => row.id) } } })).count;
}

/** Legacy CLI compatibility. */
export async function retryPendingNotifications(limit = DEFAULT_BATCH_SIZE) {
  const summary = await processNotificationBatch({ batchSize: limit });
  return [summary];
}
