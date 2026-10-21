import { AdminBloqueios } from "@/components/admin/admin-bloqueios";
import { connection } from "next/server";
import { listBarbers } from "@/lib/booking-service";
import { getBlockedSlotsOverview } from "@/lib/booking-query-service";

export const metadata = {
  title: "Bloqueios | Admin",
};

export default async function AdminBloqueiosPage() {
  await connection();
  const [blockedSlots, barbers] = await Promise.all([getBlockedSlotsOverview(), listBarbers()]);
  return <AdminBloqueios blockedSlots={blockedSlots.data} expiredBlockedSlotsCount={blockedSlots.expiredCount} barbers={barbers} />;
}
