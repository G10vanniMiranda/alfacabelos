import { NextRequest, NextResponse } from "next/server";
import { findClientBySessionToken } from "@/lib/auth/client-store";
import { getAdminSessionPrincipal } from "@/lib/auth/admin-session-store";
import { scopeBarber } from "@/lib/auth/staff-auth";
import { previewBookingSeries } from "@/lib/booking-series-service";
import { createAdminBookingSchema } from "@/lib/validators/schemas";
import { isSameOriginRequest } from "@/lib/security";

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ message: "Origem inválida" }, { status: 403 });
  const [client, staff] = await Promise.all([
    findClientBySessionToken(request.cookies.get("barber_client")?.value ?? ""),
    getAdminSessionPrincipal(request.cookies.get("barber_admin")?.value ?? ""),
  ]);
  if (!client && !staff) return NextResponse.json({ message: "Não autorizado" }, { status: 401 });
  try {
    const payload = await request.json();
    const parsed = createAdminBookingSchema.safeParse({
      ...payload,
      barberId: staff ? scopeBarber(staff, payload.barberId) : payload.barberId,
      customerName: client?.name ?? payload.customerName ?? "Previa da equipe",
      customerPhone: client?.phone ?? payload.customerPhone ?? "(69) 99999-9999",
      recurrence: payload.recurrence ?? "NONE",
      idempotencyKey: payload.recurrence && payload.recurrence !== "NONE" ? "preview-request-key" : undefined,
    });
    if (!parsed.success) return NextResponse.json({ message: parsed.error.issues[0]?.message }, { status: 400 });
    const occurrences = await previewBookingSeries({
      serviceId: parsed.data.serviceId, barberId: parsed.data.barberId,
      customerName: parsed.data.customerName, customerPhone: parsed.data.customerPhone,
      start: parsed.data.start, recurrence: parsed.data.recurrence, repeatUntil: parsed.data.repeatUntil,
      interval: parsed.data.interval, weekdays: parsed.data.weekdays, createdBy: client ? "CLIENT" : "BARBER",
    });
    return NextResponse.json({ occurrences, hasConflicts: occurrences.some((item) => !item.available) });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Falha ao gerar prévia" }, { status: 400 });
  }
}
