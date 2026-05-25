import { AdminEarnings } from "@/components/admin/admin-earnings";
import { listAdminBookings, listBarbers } from "@/lib/booking-service";
import { BUSINESS_CONFIG } from "@/lib/config";
import { getLocalDateInput, pad2 } from "@/lib/utils";
import { BookingWithRelations } from "@/types/domain";

export const metadata = {
  title: "Ganhos | Admin",
};

function getDefaultRange() {
  const today = getLocalDateInput(new Date().toISOString(), BUSINESS_CONFIG.timezone);
  const [year, month] = today.split("-").map(Number);
  const lastDay = new Date(year, month, 0).getDate();

  return {
    from: `${year}-${pad2(month)}-01`,
    to: `${year}-${pad2(month)}-${pad2(lastDay)}`,
  };
}

function isBookingInRange(booking: BookingWithRelations, from: string, to: string): boolean {
  const date = getLocalDateInput(booking.dateTimeStart, BUSINESS_CONFIG.timezone);
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

  const confirmed = filtered.filter(
    (booking) => booking.status !== "CANCELADO" && booking.paymentStatus === "CONFIRMADO",
  );
  const pending = filtered.filter(
    (booking) => booking.status !== "CANCELADO" && booking.paymentStatus === "PENDENTE",
  );

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
