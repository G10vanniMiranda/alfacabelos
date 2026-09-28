import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAdminSessionPrincipal } from "@/lib/auth/admin-session-store";
import { requestIdFromHeaders } from "@/lib/observability/context";
import { logger } from "@/lib/observability/logger";
import { replayDeadNotification } from "@/lib/notifications/replay";
import { getClientIp, isSameOriginRequest, registerRateLimitEvent } from "@/lib/security";

const replaySchema = z.object({
  notificationId: z.string().min(1).max(128),
  confirmation: z.literal("REPLAY_DEAD_NOTIFICATION"),
  reason: z.string().trim().min(5).max(80),
});

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const requestId = requestIdFromHeaders(request.headers);
  if (!isSameOriginRequest(request)) return NextResponse.json({ message: "Origem inválida", requestId }, { status: 403 });
  const principal = await getAdminSessionPrincipal(request.cookies.get("barber_admin")?.value ?? "");
  if (!principal || principal.role !== "ADMIN") return NextResponse.json({ message: "Não autorizado", requestId }, { status: 401 });
  const rateLimit = await registerRateLimitEvent({
    scope: "admin-notification-replay", identifier: `${principal.accessId}:${getClientIp(request)}`,
    windowSeconds: 60, maxAttempts: 5,
  });
  if (rateLimit.blocked) return NextResponse.json({ message: "Muitas tentativas", requestId }, { status: 429 });
  const parsed = replaySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "Confirmação de replay inválida", requestId }, { status: 400 });
  const result = await replayDeadNotification({
    notificationId: parsed.data.notificationId,
    actorId: principal.accessId,
    requestId,
    reason: parsed.data.reason,
  });
  if (!result.ok) return NextResponse.json({ message: "Notificação não está disponível para replay", reason: result.reason, requestId }, { status: 409 });
  logger.warn("notification.replay.requested", { requestId, actorId: principal.accessId, notificationId: result.notificationId, replayCount: result.replayCount });
  return NextResponse.json({ ok: true, notificationId: result.notificationId, replayCount: result.replayCount, requestId });
}
