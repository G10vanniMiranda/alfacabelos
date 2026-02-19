import { AdminHorarios } from "@/components/admin/admin-horarios";
import { listBarberAvailabilities, listBarbers } from "@/lib/booking-service";

export const metadata = {
  title: "Horarios | Admin",
};

export default async function AdminHorariosPage() {
  const barbers = await listBarbers();
  const entries = await Promise.all(
    barbers.map(async (barber) => [barber.id, await listBarberAvailabilities(barber.id)] as const),
  );

  const availabilityByBarber = Object.fromEntries(entries);
  return <AdminHorarios barbers={barbers} availabilityByBarber={availabilityByBarber} />;
}
