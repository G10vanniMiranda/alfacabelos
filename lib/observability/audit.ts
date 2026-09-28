import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sanitizeAuditMetadata } from "@/lib/observability/logger";

type DbClient = Prisma.TransactionClient | typeof prisma;

export type AuditEventInput = {
  actorType: "ADMIN" | "BARBER" | "CLIENT" | "SYSTEM";
  actorId?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  requestId: string;
  metadata?: Record<string, unknown>;
};

export async function recordAuditEvent(db: DbClient, input: AuditEventInput) {
  return db.auditLog.create({
    data: {
      id: randomUUID(),
      actorType: input.actorType,
      actorId: input.actorId,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      requestId: input.requestId,
      metadata: (sanitizeAuditMetadata(input.metadata) ?? Prisma.JsonNull) as Prisma.InputJsonValue,
    },
  });
}
