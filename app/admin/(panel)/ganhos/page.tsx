import { AdminEarnings } from "@/components/admin/admin-earnings";
import { connection } from "next/server";
import { listBarbers } from "@/lib/booking-service";
import { getEarningsData } from "@/lib/booking-query-service";
import { BUSINESS_CONFIG } from "@/lib/config";
import { getDayRangeIso, getLocalDateInput, pad2 } from "@/lib/utils";

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

export default async function AdminGanhosPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; barberId?: string }>;
}) {
  await connection();
  const params = await searchParams;
  const defaults = getDefaultRange();
  const from = params.from && /^\d{4}-\d{2}-\d{2}$/.test(params.from) ? params.from : defaults.from;
  const to = params.to && /^\d{4}-\d{2}-\d{2}$/.test(params.to) ? params.to : defaults.to;
  const barberId = params.barberId ?? "TODOS";
  const safeRange = from <= to && (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) <= 366 * 86_400_000
    ? { from, to }
    : defaults;
  const start = getDayRangeIso(safeRange.from, BUSINESS_CONFIG.timezone).start;
  const end = getDayRangeIso(safeRange.to, BUSINESS_CONFIG.timezone).end;

  const [earnings, barbers] = await Promise.all([
    getEarningsData({ start, end, barberId: barberId === "TODOS" ? undefined : barberId }),
    listBarbers(),
  ]);

  return (
    <AdminEarnings
      from={safeRange.from}
      to={safeRange.to}
      barberId={barberId}
      barbers={barbers}
      earnings={earnings}
    />
  );
}
