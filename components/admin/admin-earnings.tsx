import { Barber, BookingWithRelations } from "@/types/domain";
import { formatBRLFromCents } from "@/lib/utils";

type AdminEarningsProps = {
  from: string;
  to: string;
  barberId: string;
  barbers: Barber[];
  confirmedBookings: BookingWithRelations[];
  pendingBookings: BookingWithRelations[];
};

type RevenueGroup = {
  key: string;
  label: string;
  totalCents: number;
  bookingsCount: number;
};

function formatDateTime(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(iso));
}

function formatDayLabel(date: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(`${date}T00:00:00`));
}

function sumRevenue(bookings: BookingWithRelations[]) {
  return bookings.reduce((sum, booking) => sum + booking.service.priceCents, 0);
}

function groupRevenue(
  bookings: BookingWithRelations[],
  getKey: (booking: BookingWithRelations) => string,
  getLabel: (booking: BookingWithRelations) => string,
): RevenueGroup[] {
  const map = new Map<string, RevenueGroup>();

  for (const booking of bookings) {
    const key = getKey(booking);
    const existing = map.get(key);

    if (existing) {
      existing.totalCents += booking.service.priceCents;
      existing.bookingsCount += 1;
      continue;
    }

    map.set(key, {
      key,
      label: getLabel(booking),
      totalCents: booking.service.priceCents,
      bookingsCount: 1,
    });
  }

  return Array.from(map.values()).sort((a, b) => b.totalCents - a.totalCents);
}

export function AdminEarnings({
  from,
  to,
  barberId,
  barbers,
  confirmedBookings,
  pendingBookings,
}: AdminEarningsProps) {
  const totalConfirmedCents = sumRevenue(confirmedBookings);
  const pendingPotentialCents = sumRevenue(pendingBookings);
  const totalBookings = confirmedBookings.length;
  const averageTicketCents = totalBookings > 0 ? Math.round(totalConfirmedCents / totalBookings) : 0;

  const dailyRevenue = groupRevenue(
    confirmedBookings,
    (booking) => booking.dateTimeStart.slice(0, 10),
    (booking) => formatDayLabel(booking.dateTimeStart.slice(0, 10)),
  );
  const serviceRevenue = groupRevenue(
    confirmedBookings,
    (booking) => booking.serviceId,
    (booking) => booking.service.name,
  );
  const barberRevenue = groupRevenue(
    confirmedBookings,
    (booking) => booking.barberId,
    (booking) => booking.barber.name,
  );

  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 px-4 py-4 sm:px-5">
        <h2 className="text-xl font-semibold text-zinc-100 sm:text-2xl">Controle de ganhos</h2>
        <p className="mt-1 text-sm text-zinc-400">Acompanhe o faturamento confirmado e a previsao de entradas.</p>
      </div>

      <form className="grid gap-3 rounded-xl border border-zinc-800 bg-zinc-900/70 p-4 md:grid-cols-[180px_180px_1fr_auto]">
        <input
          type="date"
          name="from"
          defaultValue={from}
          className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
        />
        <input
          type="date"
          name="to"
          defaultValue={to}
          className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
        />
        <select
          name="barberId"
          defaultValue={barberId}
          className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
        >
          <option value="TODOS">Todos os barbeiros</option>
          {barbers.map((barber) => (
            <option key={barber.id} value={barber.id}>
              {barber.name}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-lg bg-cyan-400 px-4 py-2 text-sm font-bold text-zinc-950"
        >
          Aplicar
        </button>
      </form>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-zinc-400">Faturamento</p>
          <p className="mt-2 text-2xl font-black text-emerald-300">{formatBRLFromCents(totalConfirmedCents)}</p>
          <p className="mt-1 text-sm text-zinc-400">apenas agendamentos confirmados</p>
        </article>
        <article className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-zinc-400">Previsao</p>
          <p className="mt-2 text-2xl font-black text-amber-300">{formatBRLFromCents(pendingPotentialCents)}</p>
          <p className="mt-1 text-sm text-zinc-400">valor pendente de confirmacao</p>
        </article>
        <article className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-zinc-400">Atendimentos</p>
          <p className="mt-2 text-2xl font-black text-zinc-100">{totalBookings}</p>
          <p className="mt-1 text-sm text-zinc-400">confirmados no periodo</p>
        </article>
        <article className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-zinc-400">Ticket medio</p>
          <p className="mt-2 text-2xl font-black text-zinc-100">{formatBRLFromCents(averageTicketCents)}</p>
          <p className="mt-1 text-sm text-zinc-400">media por atendimento confirmado</p>
        </article>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5">
          <h3 className="text-lg font-semibold text-zinc-100">Ganhos por dia</h3>
          <div className="mt-4 space-y-2">
            {dailyRevenue.map((item) => (
              <article key={item.key} className="rounded-lg border border-zinc-700 bg-zinc-950/70 p-3">
                <p className="font-semibold text-zinc-100">{item.label}</p>
                <p className="mt-1 text-sm text-cyan-300">{formatBRLFromCents(item.totalCents)}</p>
                <p className="mt-1 text-xs text-zinc-500">{item.bookingsCount} confirmado(s)</p>
              </article>
            ))}
            {dailyRevenue.length === 0 ? <p className="text-sm text-zinc-500">Sem faturamento no periodo.</p> : null}
          </div>
        </section>

        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5">
          <h3 className="text-lg font-semibold text-zinc-100">Ganhos por servico</h3>
          <div className="mt-4 space-y-2">
            {serviceRevenue.map((item) => (
              <article key={item.key} className="rounded-lg border border-zinc-700 bg-zinc-950/70 p-3">
                <p className="font-semibold text-zinc-100">{item.label}</p>
                <p className="mt-1 text-sm text-cyan-300">{formatBRLFromCents(item.totalCents)}</p>
                <p className="mt-1 text-xs text-zinc-500">{item.bookingsCount} confirmado(s)</p>
              </article>
            ))}
            {serviceRevenue.length === 0 ? <p className="text-sm text-zinc-500">Sem servicos confirmados no periodo.</p> : null}
          </div>
        </section>

        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5">
          <h3 className="text-lg font-semibold text-zinc-100">Ganhos por barbeiro</h3>
          <div className="mt-4 space-y-2">
            {barberRevenue.map((item) => (
              <article key={item.key} className="rounded-lg border border-zinc-700 bg-zinc-950/70 p-3">
                <p className="font-semibold text-zinc-100">{item.label}</p>
                <p className="mt-1 text-sm text-cyan-300">{formatBRLFromCents(item.totalCents)}</p>
                <p className="mt-1 text-xs text-zinc-500">{item.bookingsCount} confirmado(s)</p>
              </article>
            ))}
            {barberRevenue.length === 0 ? <p className="text-sm text-zinc-500">Sem barbeiros com ganhos no periodo.</p> : null}
          </div>
        </section>
      </div>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5">
        <h3 className="text-lg font-semibold text-zinc-100">Ultimos recebimentos confirmados</h3>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="text-zinc-400">
              <tr>
                <th className="px-2 py-2">Cliente</th>
                <th className="px-2 py-2">Servico</th>
                <th className="px-2 py-2">Barbeiro</th>
                <th className="px-2 py-2">Data</th>
                <th className="px-2 py-2">Valor</th>
              </tr>
            </thead>
            <tbody>
              {confirmedBookings
                .slice()
                .sort((a, b) => new Date(b.dateTimeStart).getTime() - new Date(a.dateTimeStart).getTime())
                .slice(0, 20)
                .map((booking) => (
                  <tr key={booking.id} className="border-t border-zinc-800 text-zinc-200">
                    <td className="px-2 py-2">{booking.customerName}</td>
                    <td className="px-2 py-2">{booking.service.name}</td>
                    <td className="px-2 py-2">{booking.barber.name}</td>
                    <td className="px-2 py-2 text-zinc-400">{formatDateTime(booking.dateTimeStart)}</td>
                    <td className="px-2 py-2 text-emerald-300">{formatBRLFromCents(booking.service.priceCents)}</td>
                  </tr>
                ))}
              {confirmedBookings.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-2 py-4 text-center text-zinc-500">
                    Nenhum recebimento confirmado no periodo selecionado.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
