import { AdminOverview } from "@/components/admin/admin-overview";
import { listAdminBookings, listBarbers, listBlockedSlots, listServices } from "@/lib/booking-service";
import { Barber, BlockedSlot, BookingWithRelations, Service } from "@/types/domain";

export const metadata = {
  title: "Dashboard | Admin",
};

export default async function AdminDashboardPage() {
  const [bookings, barbers, blockedSlots, services]: [
    BookingWithRelations[],
    Barber[],
    BlockedSlot[],
    Service[],
  ] = await Promise.all([
    listAdminBookings({}),
    listBarbers(),
    listBlockedSlots(),
    listServices(),
  ]);

  return <AdminOverview bookings={bookings} barbers={barbers} blockedSlots={blockedSlots} services={services} />;
}
