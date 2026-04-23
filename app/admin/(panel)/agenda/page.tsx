import { AdminAgenda } from "@/components/admin/admin-agenda";
import { listAdminBookings, listBarbers, listServices } from "@/lib/booking-service";

export const metadata = {
  title: "Agenda | Admin",
};

export default async function AdminAgendaPage() {
  const [bookings, barbers, services] = await Promise.all([listAdminBookings({}), listBarbers(), listServices()]);
  return <AdminAgenda bookings={bookings} barbers={barbers} services={services} />;
}
