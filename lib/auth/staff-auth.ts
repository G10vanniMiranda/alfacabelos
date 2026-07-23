import { cookies } from "next/headers";
import { getAdminSessionPrincipal, type StaffPrincipal } from "@/lib/auth/admin-session-store";
import type { AccessRole } from "@/types/domain";

export const STAFF_COOKIE = "barber_admin";

export async function getCurrentStaff(): Promise<StaffPrincipal | null> {
  const token = (await cookies()).get(STAFF_COOKIE)?.value ?? "";
  try {
    return await getAdminSessionPrincipal(token);
  } catch {
    return null;
  }
}

export async function requireStaff(allowed?: AccessRole[]): Promise<StaffPrincipal> {
  const principal = await getCurrentStaff();
  if (!principal || (allowed && !allowed.includes(principal.role))) throw new Error("Não autorizado");
  if (principal.role === "BARBER" && !principal.barberId) throw new Error("Acesso de barbeiro sem vínculo ativo");
  return principal;
}

export function scopeBarber(principal: StaffPrincipal, requested?: string | null): string | undefined {
  return principal.role === "BARBER" ? principal.barberId : requested ?? undefined;
}

export async function assertBookingScope(principal: StaffPrincipal, bookingId: string): Promise<void> {
  if (principal.role === "ADMIN") return;
  const { prisma } = await import("@/lib/prisma");
  const owned = await prisma.booking.count({ where: { id: bookingId, barberId: principal.barberId } });
  if (!owned) throw new Error("Não autorizado para este agendamento");
}

export async function assertBlockedSlotScope(principal: StaffPrincipal, blockedSlotId: string): Promise<void> {
  if (principal.role === "ADMIN") return;
  const { prisma } = await import("@/lib/prisma");
  const owned = await prisma.blockedSlot.count({ where: { id: blockedSlotId, barberId: principal.barberId } });
  if (!owned) throw new Error("Não autorizado para este bloqueio");
}
