import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  notificationClaimEligibilitySql,
  notificationMaxAttempts,
  notificationStaleBefore,
} from "@/lib/notifications/claim-policy";

type MetricsRow = {
  pending: bigint;
  processing: bigint;
  retry: bigint;
  sent: bigint;
  dead: bigint;
  eligibleNow: bigint;
  oldestBacklogAt: Date | null;
  oldestEligibleAt: Date | null;
  retries24h: bigint;
  sent24h: bigint;
  dead24h: bigint;
  averageDeliveryMs24h: number | null;
  p95DeliveryMs24h: number | null;
};

export type OperationalNotificationMetrics = {
  pending: number;
  processing: number;
  retry: number;
  sent: number;
  dead: number;
  backlog: number;
  eligibleNow: number;
  oldestBacklogAt: string | null;
  oldestEligibleAt: string | null;
  oldestReadyAt: string | null;
  oldestPendingAgeSeconds: number | null;
  oldestEligibleAgeSeconds: number | null;
  retries24h: number;
  sent24h: number;
  dead24h: number;
  successRate24h: number | null;
  errorRate24h: number | null;
  averageDeliveryMs24h: number | null;
  p95DeliveryMs24h: number | null;
  byEventType: Array<{ eventType: string; status: string; count: number }>;
};

export function deriveNotificationQueueDepths(input: {
  pending: number;
  retry: number;
  eligibleNow: number;
}): { backlog: number; eligibleNow: number } {
  return {
    backlog: input.pending + input.retry,
    eligibleNow: input.eligibleNow,
  };
}

export async function getOperationalNotificationMetrics(now = new Date()): Promise<OperationalNotificationMetrics> {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const eligibility = notificationClaimEligibilitySql({
    now,
    maxAttempts: notificationMaxAttempts(),
    staleBefore: notificationStaleBefore(now),
  });
  const [rows, groups] = await Promise.all([
    prisma.$queryRaw<MetricsRow[]>(Prisma.sql`
      SELECT
        COUNT(*) FILTER (WHERE "status" = 'PENDING')::bigint AS "pending",
        COUNT(*) FILTER (WHERE "status" = 'PROCESSING')::bigint AS "processing",
        COUNT(*) FILTER (WHERE "status" = 'RETRY')::bigint AS "retry",
        COUNT(*) FILTER (WHERE "status" = 'SENT')::bigint AS "sent",
        COUNT(*) FILTER (WHERE "status" = 'DEAD')::bigint AS "dead",
        COUNT(*) FILTER (WHERE ${eligibility})::bigint AS "eligibleNow",
        MIN("createdAt") FILTER (WHERE "status" IN ('PENDING', 'RETRY')) AS "oldestBacklogAt",
        MIN("createdAt") FILTER (WHERE ${eligibility}) AS "oldestEligibleAt",
        COALESCE(SUM(GREATEST("attempts" - 1, 0)) FILTER (WHERE "updatedAt" >= ${since}), 0)::bigint AS "retries24h",
        COUNT(*) FILTER (WHERE "status" = 'SENT' AND "processedAt" >= ${since})::bigint AS "sent24h",
        COUNT(*) FILTER (WHERE "status" = 'DEAD' AND "processedAt" >= ${since})::bigint AS "dead24h",
        AVG(EXTRACT(EPOCH FROM ("sentAt" - "createdAt")) * 1000)
          FILTER (WHERE "status" = 'SENT' AND "sentAt" >= ${since})::double precision AS "averageDeliveryMs24h",
        percentile_cont(0.95) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM ("sentAt" - "createdAt")) * 1000
        ) FILTER (WHERE "status" = 'SENT' AND "sentAt" >= ${since})::double precision AS "p95DeliveryMs24h"
      FROM "NotificationDelivery"
    `),
    prisma.notificationDelivery.groupBy({
      by: ["event", "status"],
      _count: { _all: true },
      where: { createdAt: { gte: since } },
    }),
  ]);
  const row = rows[0] ?? {
    pending: BigInt(0), processing: BigInt(0), retry: BigInt(0), sent: BigInt(0), dead: BigInt(0),
    eligibleNow: BigInt(0), oldestBacklogAt: null, oldestEligibleAt: null,
    retries24h: BigInt(0), sent24h: BigInt(0), dead24h: BigInt(0),
    averageDeliveryMs24h: null, p95DeliveryMs24h: null,
  };
  const pending = Number(row.pending);
  const retry = Number(row.retry);
  const sent24h = Number(row.sent24h);
  const dead24h = Number(row.dead24h);
  const terminals24h = sent24h + dead24h;
  const queueDepths = deriveNotificationQueueDepths({
    pending,
    retry,
    eligibleNow: Number(row.eligibleNow),
  });
  return {
    pending,
    processing: Number(row.processing),
    retry,
    sent: Number(row.sent),
    dead: Number(row.dead),
    ...queueDepths,
    oldestBacklogAt: row.oldestBacklogAt?.toISOString() ?? null,
    oldestEligibleAt: row.oldestEligibleAt?.toISOString() ?? null,
    oldestReadyAt: row.oldestEligibleAt?.toISOString() ?? null,
    oldestPendingAgeSeconds: row.oldestBacklogAt ? Math.max(0, Math.floor((now.getTime() - row.oldestBacklogAt.getTime()) / 1000)) : null,
    oldestEligibleAgeSeconds: row.oldestEligibleAt ? Math.max(0, Math.floor((now.getTime() - row.oldestEligibleAt.getTime()) / 1000)) : null,
    retries24h: Number(row.retries24h),
    sent24h,
    dead24h,
    successRate24h: terminals24h ? sent24h / terminals24h : null,
    errorRate24h: terminals24h ? dead24h / terminals24h : null,
    averageDeliveryMs24h: row.averageDeliveryMs24h,
    p95DeliveryMs24h: row.p95DeliveryMs24h,
    byEventType: groups.map((group) => ({ eventType: group.event, status: group.status, count: group._count._all })),
  };
}
