import { NextRequest, NextResponse } from "next/server";
import { getAdminSessionPrincipal } from "@/lib/auth/admin-session-store";
import { scopeBarber } from "@/lib/auth/staff-auth";
import { listOwnerAlerts } from "@/lib/notifications/owner-alerts";
import { requestIdFromHeaders } from "@/lib/observability/context";
import { logger } from "@/lib/observability/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const requestId = requestIdFromHeaders(request.headers);
  const principal = await getAdminSessionPrincipal(request.cookies.get("barber_admin")?.value ?? "");
  if (!principal) return NextResponse.json({ message: "Não autorizado" }, { status: 401 });
  // Same rule as requireStaff: a barber login without an active barber link sees nothing.
  if (principal.role === "BARBER" && !principal.barberId) {
    return NextResponse.json({ message: "Acesso de barbeiro sem vínculo ativo" }, { status: 403 });
  }
  try {
    const alerts = await listOwnerAlerts({ barberId: scopeBarber(principal) });
    return NextResponse.json({ alerts }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    logger.error("admin.alerts.list_failed", { requestId, actorId: principal.accessId, error });
    return NextResponse.json({ message: "Não foi possível carregar os avisos" }, { status: 503 });
  }
}
