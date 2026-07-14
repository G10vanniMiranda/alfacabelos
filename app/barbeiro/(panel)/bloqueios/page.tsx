import { AdminBloqueios } from "@/components/admin/admin-bloqueios";
import { getCurrentStaff } from "@/lib/auth/staff-auth";
import { listBarbers, listBlockedSlots } from "@/lib/booking-service";

export const metadata = { title: "Meus bloqueios | Alfa" };

export default async function BarberBlocksPage() {
  const staff = await getCurrentStaff();
  const barberId = staff?.barberId ?? "";
  const [blocked, allBarbers] = await Promise.all([listBlockedSlots(), listBarbers()]);
  return <AdminBloqueios blockedSlots={blocked.filter((slot) => slot.barberId === barberId)} barbers={allBarbers.filter((barber) => barber.id === barberId)} />;
}
