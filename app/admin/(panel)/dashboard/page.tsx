import { AdminOverview } from "@/components/admin/admin-overview";
import { listAdminBookings, listBarbers, listBlockedSlots, listServices } from "@/lib/booking-service";
import { Barber, BlockedSlot, BookingWithRelations, Service } from "@/types/domain";

export const metadata = {
  title: "Dashboard | Admin",
};

export default async function AdminDashboardPage() {
  let bookings: BookingWithRelations[] = [];
  let barbers: Barber[] = [];
  let blockedSlots: BlockedSlot[] = [];
  let services: Service[] = [];

  try {
    [bookings, barbers, blockedSlots, services] = await Promise.all([
      listAdminBookings({}),
      listBarbers(),
      listBlockedSlots(),
      listServices(),
    ]);
  } catch (error) {
    console.error("Falha ao carregar dashboard admin", error);
  }

  return <AdminOverview bookings={bookings} barbers={barbers} blockedSlots={blockedSlots} services={services} />;
}
