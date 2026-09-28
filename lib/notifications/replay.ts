import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAuditEvent } from "@/lib/observability/audit";

export type ReplayResult =
  | { ok: true; notificationId: string; replayCount: number }
  | { ok: false; reason: "not_found" | "not_dead" | "already_replayed" };

export async function replayDeadNotification(input: {
  notificationId: string;
  actorId: string;
  requestId: string;
  reason: string;
}): Promise<ReplayResult> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const delivery = await tx.notificationDelivery.findUnique({
          where: { id: input.notificationId },
          select: { id: true, status: true, attempts: true, replayCount: true, errorCategory: true, bookingId: true },
        });
        if (!delivery) return { ok: false, reason: "not_found" };
        if (delivery.status !== "DEAD") return { ok: false, reason: delivery.replayCount > 0 ? "already_replayed" : "not_dead" };
        const now = new Date();
        const updated = await tx.notificationDelivery.updateMany({
          where: { id: delivery.id, status: "DEAD", replayCount: delivery.replayCount },
          data: {
            // An explicit audited replay grants a fresh attempt budget. The
            // previous counter is retained in the audit metadata below.
            status: "RETRY", attempts: 0, eligibleAt: now, nextRetryAt: now, processedAt: null,
            lockedAt: null, lockedBy: null, lastError: null, errorCategory: null,
            replayCount: { increment: 1 }, lastReplayedAt: now,
          },
        });
        if (updated.count !== 1) return { ok: false, reason: "already_replayed" };
        await recordAuditEvent(tx, {
          actorType: "ADMIN", actorId: input.actorId,
          action: "notification.dead.replayed", resourceType: "NotificationDelivery",
          resourceId: delivery.id, requestId: input.requestId,
          metadata: {
            reasonCode: input.reason.slice(0, 80), previousAttempts: delivery.attempts,
            previousErrorCategory: delivery.errorCategory, bookingId: delivery.bookingId,
          },
        });
        return { ok: true, notificationId: delivery.id, replayCount: delivery.replayCount + 1 };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") || attempt === 1) throw error;
    }
  }
  return { ok: false, reason: "already_replayed" };
}
