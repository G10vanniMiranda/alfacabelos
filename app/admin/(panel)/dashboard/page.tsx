import { AdminOverview } from "@/components/admin/admin-overview";
import { connection } from "next/server";
import { listBarbers, listServices } from "@/lib/booking-service";
import { getAdminDashboardData } from "@/lib/booking-query-service";
import { BUSINESS_CONFIG } from "@/lib/config";
import { getDayRangeIso, getTodayInTimeZone } from "@/lib/utils";

export const metadata = {
  title: "Dashboard | Admin",
};

export default async function AdminDashboardPage() {
  await connection();
  const today = getTodayInTimeZone(BUSINESS_CONFIG.timezone);
  const range = getDayRangeIso(today, BUSINESS_CONFIG.timezone);
  const [dashboard, barbers, services] = await Promise.all([
    getAdminDashboardData(range.start, range.end),
    listBarbers(),
    listServices(),
  ]);

  return <AdminOverview dashboard={dashboard} barbers={barbers} services={services} />;
}
