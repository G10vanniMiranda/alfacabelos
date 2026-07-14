import { AdminAgenda } from "@/components/admin/admin-agenda";
import { getCurrentStaff } from "@/lib/auth/staff-auth";
import { listAdminBookings, listBarbers, listServices } from "@/lib/booking-service";

export const metadata = { title: "Minha agenda | Alfa" };

export default async function BarberAgendaPage() {
  const staff = await getCurrentStaff();
  const barberId = staff?.barberId ?? "";
  const [bookings, allBarbers, services] = await Promise.all([
    listAdminBookings({ barberId }), listBarbers(), listServices(),
  ]);
  return <AdminAgenda bookings={bookings} barbers={allBarbers.filter((barber) => barber.id === barberId)} services={services} />;
}
