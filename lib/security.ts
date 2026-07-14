import { createHash, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hashRateLimitIdentifier(value: string): string {
  return sha256(value.trim().toLowerCase().slice(0, 256));
}

export async function registerRateLimitEvent(input: {
  scope: string;
  identifier: string;
  windowSeconds: number;
  maxAttempts: number;
}): Promise<{ blocked: boolean; retryAfterSeconds: number }> {
  try {
    const identifierHash = hashRateLimitIdentifier(input.identifier);
    const now = new Date();
    const windowStart = new Date(now.getTime() - input.windowSeconds * 1000);
    const cleanupBefore = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    await prisma.securityRateLimitEvent.deleteMany({
      where: { createdAt: { lt: cleanupBefore } },
    });

    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${input.scope}:${identifierHash}`}))`;
      const [firstEvent, count] = await Promise.all([
        tx.securityRateLimitEvent.findFirst({
          where: { scope: input.scope, identifierHash, createdAt: { gte: windowStart } },
          orderBy: { createdAt: "asc" }, select: { createdAt: true },
        }),
        tx.securityRateLimitEvent.count({
          where: { scope: input.scope, identifierHash, createdAt: { gte: windowStart } },
        }),
      ]);
      if (count >= input.maxAttempts) {
        const retryAfterSeconds = firstEvent
          ? Math.max(1, Math.ceil((firstEvent.createdAt.getTime() + input.windowSeconds * 1000 - now.getTime()) / 1000))
          : input.windowSeconds;
        return { blocked: true, retryAfterSeconds };
      }
      await tx.securityRateLimitEvent.create({
        data: { id: randomUUID(), scope: input.scope, identifierHash },
      });
      return { blocked: false, retryAfterSeconds: 0 };
    });
  } catch (error) {
    const maybe = error as { code?: string; message?: string };
    if (maybe?.code === "P2021" || maybe?.message?.includes("SecurityRateLimitEvent")) {
      return { blocked: false, retryAfterSeconds: 0 };
    }
    throw error;
  }
}

export async function clearRateLimitEvents(scope: string, identifier: string): Promise<void> {
  await prisma.securityRateLimitEvent.deleteMany({
    where: { scope, identifierHash: hashRateLimitIdentifier(identifier) },
  });
}

export function isSameOriginRequest(request: NextRequest): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") {
    return false;
  }

  const origin = request.headers.get("origin");
  if (!origin) {
    return true;
  }

  try {
    return new URL(origin).origin === request.nextUrl.origin;
  } catch {
    return false;
  }
}

export function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}
