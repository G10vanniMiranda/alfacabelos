import { AdminOverview } from "@/components/admin/admin-overview";
import { listAdminBookings, listBarbers, listBlockedSlots, listServices } from "@/lib/booking-service";

export const metadata = {
  title: "Dashboard | Admin",
};

export default async function AdminDashboardPage() {
  const [bookings, barbers, blockedSlots, services] = await Promise.all([
    listAdminBookings({}),
    listBarbers(),
    listBlockedSlots(),
    listServices(),
  ]);

  return <AdminOverview bookings={bookings} barbers={barbers} blockedSlots={blockedSlots} services={services} />;
}

