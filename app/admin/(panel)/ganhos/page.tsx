import { AdminEarnings } from "@/components/admin/admin-earnings";
import { listAdminBookings, listBarbers } from "@/lib/booking-service";
import { formatDateInput } from "@/lib/utils";
import { BookingWithRelations } from "@/types/domain";

export const metadata = {
  title: "Ganhos | Admin",
};

function getDefaultRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return {
    from: formatDateInput(start),
    to: formatDateInput(end),
  };
}

function isBookingInRange(booking: BookingWithRelations, from: string, to: string): boolean {
  const date = booking.dateTimeStart.slice(0, 10);
  return date >= from && date <= to;
}

export default async function AdminGanhosPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; barberId?: string }>;
}) {
  const params = await searchParams;
  const defaults = getDefaultRange();
  const from = params.from && /^\d{4}-\d{2}-\d{2}$/.test(params.from) ? params.from : defaults.from;
  const to = params.to && /^\d{4}-\d{2}-\d{2}$/.test(params.to) ? params.to : defaults.to;
  const barberId = params.barberId ?? "TODOS";

  const [bookings, barbers] = await Promise.all([listAdminBookings({}), listBarbers()]);

  const filtered = bookings.filter((booking) => {
    if (!isBookingInRange(booking, from, to)) {
      return false;
    }
    if (barberId !== "TODOS" && booking.barberId !== barberId) {
      return false;
    }
    return true;
  });

  const confirmed = filtered.filter((booking) => booking.status === "CONFIRMADO");
  const pending = filtered.filter((booking) => booking.status === "PENDENTE");

  return (
    <AdminEarnings
      from={from}
      to={to}
      barberId={barberId}
      barbers={barbers}
      confirmedBookings={confirmed}
      pendingBookings={pending}
    />
  );
}
