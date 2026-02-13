import { AdminAgenda } from "@/components/admin/admin-agenda";
import { listAdminBookings, listBarbers } from "@/lib/booking-service";

export const metadata = {
  title: "Agenda | Admin",
};

export default async function AdminAgendaPage() {
  const [bookings, barbers] = await Promise.all([listAdminBookings({}), listBarbers()]);
  return <AdminAgenda bookings={bookings} barbers={barbers} />;
}
