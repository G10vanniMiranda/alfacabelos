import { AdminAgenda } from "@/components/admin/admin-agenda";
import { connection } from "next/server";
import { listBarbers, listServices } from "@/lib/booking-service";
import { listBookingRange } from "@/lib/booking-query-service";
import { BUSINESS_CONFIG } from "@/lib/config";
import { ADMIN_BOOKINGS_DEFAULT_LIMIT } from "@/lib/query-contracts";
import { getDayRangeIso, getTodayInTimeZone } from "@/lib/utils";

export const metadata = {
  title: "Agenda | Admin",
};

export default async function AdminAgendaPage() {
  await connection();
  const today = getTodayInTimeZone(BUSINESS_CONFIG.timezone);
  const range = getDayRangeIso(today, BUSINESS_CONFIG.timezone);
  const [bookings, barbers, services] = await Promise.all([
    listBookingRange({ ...range, limit: ADMIN_BOOKINGS_DEFAULT_LIMIT }),
    listBarbers(),
    listServices(),
  ]);
  return <AdminAgenda bookings={bookings.data} initialLastUpdatedAt={bookings.lastUpdatedAt} barbers={barbers} services={services} />;
}
