import { AdminBloqueios } from "@/components/admin/admin-bloqueios";
import { listBarbers, listBlockedSlots } from "@/lib/booking-service";

export const metadata = {
  title: "Bloqueios | Admin",
};

export default async function AdminBloqueiosPage() {
  const [blockedSlots, barbers] = await Promise.all([listBlockedSlots(), listBarbers()]);
  return <AdminBloqueios blockedSlots={blockedSlots} barbers={barbers} />;
}
