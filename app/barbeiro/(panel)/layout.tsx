import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentStaff } from "@/lib/auth/staff-auth";
import { BarberSidebar } from "@/components/barber/barber-sidebar";
import { ToastProvider } from "@/components/ui/toast";

export default async function BarberPanelLayout({ children }: { children: React.ReactNode }) {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/admin?reason=session-expired");
  if (staff.role === "ADMIN") redirect("/admin/dashboard");
  if (!staff.barberId) redirect("/admin?reason=access-denied");
  const barber = await prisma.barber.findUnique({ where: { id: staff.barberId }, select: { name: true, isActive: true } });
  if (!barber?.isActive) redirect("/admin?reason=access-denied");
  return <ToastProvider><main className="mx-auto grid min-h-screen max-w-7xl gap-5 px-3 py-4 sm:px-6 xl:grid-cols-[260px_minmax(0,1fr)]"><BarberSidebar name={barber.name} /><div className="min-w-0">{children}</div></main></ToastProvider>;
}
