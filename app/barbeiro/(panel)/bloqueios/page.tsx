import { AdminBloqueios } from "@/components/admin/admin-bloqueios";
import { connection } from "next/server";
import { getCurrentStaff } from "@/lib/auth/staff-auth";
import { listBarbers } from "@/lib/booking-service";
import { getBlockedSlotsOverview } from "@/lib/booking-query-service";

export const metadata = { title: "Meus bloqueios | Alfa" };

export default async function BarberBlocksPage() {
  await connection();
  const staff = await getCurrentStaff();
  const barberId = staff?.barberId ?? "";
  const [blocked, allBarbers] = await Promise.all([getBlockedSlotsOverview({ barberId }), listBarbers()]);
  return <AdminBloqueios blockedSlots={blocked.data} expiredBlockedSlotsCount={blocked.expiredCount} barbers={allBarbers.filter((barber) => barber.id === barberId)} />;
}
