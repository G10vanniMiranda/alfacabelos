import { AdminAgenda } from "@/components/admin/admin-agenda";
import { connection } from "next/server";
import { getCurrentStaff } from "@/lib/auth/staff-auth";
import { listBarbers, listServices } from "@/lib/booking-service";
import { listBookingRange } from "@/lib/booking-query-service";
import { BUSINESS_CONFIG } from "@/lib/config";
import { ADMIN_BOOKINGS_DEFAULT_LIMIT } from "@/lib/query-contracts";
import { getDayRangeIso, getTodayInTimeZone } from "@/lib/utils";

export const metadata = { title: "Minha agenda | Alfa" };

export default async function BarberAgendaPage() {
  await connection();
  const staff = await getCurrentStaff();
  const barberId = staff?.barberId ?? "";
  const today = getTodayInTimeZone(BUSINESS_CONFIG.timezone);
  const range = getDayRangeIso(today, BUSINESS_CONFIG.timezone);
  const [bookings, allBarbers, services] = await Promise.all([
    listBookingRange({ ...range, barberId, limit: ADMIN_BOOKINGS_DEFAULT_LIMIT }), listBarbers(), listServices(),
  ]);
  return <AdminAgenda bookings={bookings.data} initialLastUpdatedAt={bookings.lastUpdatedAt} barbers={allBarbers.filter((barber) => barber.id === barberId)} services={services} />;
}
