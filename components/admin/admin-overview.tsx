import Link from "next/link";
import { StatusBadge } from "@/components/ui/status-badge";
import { BUSINESS_CONFIG } from "@/lib/config";
import { Barber, BlockedSlot, BookingWithRelations, Service } from "@/types/domain";
import { formatBRLFromCents, formatDateTimeInTimeZone, getLocalDateInput, getTimeLabelInTimeZone } from "@/lib/utils";

type AdminOverviewProps = {
  bookings: BookingWithRelations[];
  blockedSlots: BlockedSlot[];
  services: Service[];
  barbers: Barber[];
};

function formatDateTime(iso: string) {
  return formatDateTimeInTimeZone(iso, BUSINESS_CONFIG.timezone, {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDay(iso: string) {
  return formatDateTimeInTimeZone(iso, BUSINESS_CONFIG.timezone, {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  });
}

function percent(value: number, total: number) {
  if (total <= 0) return 0;
  return Math.round((value / total) * 100);
}

export function AdminOverview({ bookings, blockedSlots, services, barbers }: AdminOverviewProps) {
  const now = new Date();
  const today = getLocalDateInput(now.toISOString(), BUSINESS_CONFIG.timezone);

  const activeBookings = bookings.filter((booking) => booking.status !== "CANCELADO");
  const todayBookings = bookings.filter(
    (booking) => getLocalDateInput(booking.dateTimeStart, BUSINESS_CONFIG.timezone) === today,
  );
  const todayConfirmed = todayBookings.filter((booking) => booking.status === "CONFIRMADO");
  const todayPending = todayBookings.filter((booking) => booking.status === "PENDENTE");
  const todayRevenueCents = todayBookings
    .filter((booking) => booking.paymentStatus === "CONFIRMADO" && booking.status !== "CANCELADO")
    .reduce((sum, booking) => sum + booking.service.priceCents, 0);

  const futureBookings = activeBookings
    .filter((booking) => new Date(booking.dateTimeStart).getTime() >= now.getTime())
    .sort((a, b) => new Date(a.dateTimeStart).getTime() - new Date(b.dateTimeStart).getTime());

  const recentBookings = bookings
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 7);

  const activeBlocked = blockedSlots.filter((slot) => new Date(slot.dateTimeEnd).getTime() >= now.getTime());
  const confirmationRate = percent(todayConfirmed.length, todayBookings.length);
  const nextBooking = futureBookings[0];

  const metrics = [
    {
      label: "Hoje",
      value: String(todayBookings.length),
      helper: `${todayConfirmed.length} confirmados, ${todayPending.length} pendentes`,
      tone: "text-zinc-100",
    },
    {
      label: "Receita confirmada",
      value: formatBRLFromCents(todayRevenueCents),
      helper: "pagamentos confirmados hoje",
      tone: "text-emerald-200",
    },
    {
      label: "Taxa de confirmação",
      value: `${confirmationRate}%`,
      helper: "sobre os agendamentos do dia",
      tone: "text-cyan-100",
    },
    {
      label: "Bloqueios ativos",
      value: String(activeBlocked.length),
      helper: `${services.length} serviços e ${barbers.length} profissional(is)`,
      tone: "text-amber-200",
    },
  ];

  return (
    <section className="min-w-0 space-y-6">
      <header className="premium-card rounded-3xl p-5 sm:p-7">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="eyebrow">Visão geral</p>
            <h2 className="mt-3 text-3xl font-semibold text-zinc-100 sm:text-4xl">Como está o dia?</h2>
            <p className="mt-2 max-w-2xl text-sm text-zinc-400">
              Acompanhe atendimentos, pendências e o resultado da operação com dados reais.
            </p>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-4 py-3">
            <p className="text-xs text-zinc-500">Próximo atendimento</p>
            {nextBooking ? (
              <>
                <p className="mt-1 text-sm font-semibold text-zinc-100">{nextBooking.customerName}</p>
                <p className="text-xs text-cyan-100">
                  {getTimeLabelInTimeZone(nextBooking.dateTimeStart, BUSINESS_CONFIG.timezone)} •{" "}
                  {nextBooking.service.name}
                </p>
              </>
            ) : (
              <p className="mt-1 text-sm font-semibold text-zinc-400">Sem próximos horários</p>
            )}
          </div>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <article key={metric.label} className="premium-card rounded-2xl p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">{metric.label}</p>
            <p className={`mt-3 text-3xl font-black ${metric.tone}`}>{metric.value}</p>
            <p className="mt-1 text-sm text-zinc-400">{metric.helper}</p>
          </article>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.45fr_0.9fr]">
        <section className="premium-card rounded-2xl p-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-lg font-semibold text-zinc-100">Próximos atendimentos</h3>
              <p className="mt-1 text-sm text-zinc-500">Agenda ativa ordenada por horário.</p>
            </div>
            <Link href="/admin/agenda" className="text-sm font-semibold text-amber-200 hover:text-amber-100">
              Abrir agenda
            </Link>
          </div>

          <div className="mt-4 overflow-hidden rounded-xl border border-zinc-800">
            {futureBookings.slice(0, 8).map((booking) => (
              <article
                key={booking.id}
                className="grid gap-3 border-b border-zinc-800 bg-zinc-950/40 px-4 py-3 last:border-b-0 sm:grid-cols-[92px_1fr_auto]"
              >
                <div>
                  <p className="text-xs uppercase tracking-wide text-zinc-500">{formatDay(booking.dateTimeStart)}</p>
                  <p className="mt-1 text-lg font-bold text-amber-100">
                    {getTimeLabelInTimeZone(booking.dateTimeStart, BUSINESS_CONFIG.timezone)}
                  </p>
                </div>
                <div>
                  <p className="font-semibold text-zinc-100">{booking.customerName}</p>
                  <p className="mt-1 text-sm text-zinc-400">
                    {booking.service.name} com {booking.barber.name}
                  </p>
                </div>
                <div className="self-center sm:text-right">
                  <StatusBadge status={booking.status} />
                  <p className="mt-2 text-xs text-zinc-500">{booking.customerPhone}</p>
                </div>
              </article>
            ))}
            {futureBookings.length === 0 ? (
              <p className="bg-zinc-950/40 px-4 py-6 text-center text-sm text-zinc-500">Sem atendimentos futuros.</p>
            ) : null}
          </div>
        </section>

        <aside className="space-y-4">
          <section className="premium-card rounded-2xl p-5">
            <h3 className="text-lg font-semibold text-zinc-100">Atalhos</h3>
            <div className="mt-4 grid gap-2">
              {[
                ["Agenda", "/admin/agenda"],
                ["Horários", "/admin/horarios"],
                ["Serviços", "/admin/servicos"],
                ["Financeiro", "/admin/ganhos"],
                ["Bloqueios", "/admin/bloqueios"],
                ["Galeria", "/admin/galeria"],
              ].map(([label, href]) => (
                <Link
                  key={href}
                  href={href}
                  className="flex min-h-11 items-center justify-between rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-sm text-zinc-200 transition hover:border-amber-200/50 hover:text-amber-100"
                >
                  <span>{label}</span>
                  <span className="text-zinc-500">{">"}</span>
                </Link>
              ))}
            </div>
          </section>

          <section className="premium-card rounded-2xl p-5">
            <h3 className="text-lg font-semibold text-zinc-100">Saúde do dia</h3>
            <div className="mt-4 space-y-4">
              <div>
                <div className="flex justify-between text-sm">
                  <span className="text-zinc-400">Confirmação</span>
                  <span className="font-semibold text-zinc-100">{confirmationRate}%</span>
                </div>
                <div className="mt-2 h-2 rounded-full bg-zinc-800">
                  <div className="h-2 rounded-full bg-amber-200" style={{ width: `${confirmationRate}%` }} />
                </div>
              </div>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
                  <dt className="text-zinc-500">Ativos</dt>
                  <dd className="mt-1 font-semibold text-zinc-100">{activeBookings.length}</dd>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
                  <dt className="text-zinc-500">Recentes</dt>
                  <dd className="mt-1 font-semibold text-zinc-100">{recentBookings.length}</dd>
                </div>
              </dl>
            </div>
          </section>
        </aside>
      </div>

      <section className="premium-card rounded-2xl p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-zinc-100">Atividade recente</h3>
            <p className="mt-1 text-sm text-zinc-500">Últimos agendamentos criados no sistema.</p>
          </div>
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
            {bookings.length} registros
          </span>
        </div>

        <div className="mt-4 overflow-x-auto rounded-xl border border-zinc-800">
          <table className="w-full min-w-170 text-left text-sm">
            <thead className="bg-zinc-950/70 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-3">Cliente</th>
                <th className="px-4 py-3">Servico</th>
                <th className="px-4 py-3">Criado em</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Pagamento</th>
              </tr>
            </thead>
            <tbody>
              {recentBookings.map((booking) => (
                <tr key={booking.id} className="border-t border-zinc-800 bg-zinc-950/30 text-zinc-200">
                  <td className="px-4 py-3">
                    <p className="font-semibold text-zinc-100">{booking.customerName}</p>
                    <p className="text-xs text-zinc-500">{booking.customerPhone}</p>
                  </td>
                  <td className="px-4 py-3">{booking.service.name}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-zinc-400">{formatDateTime(booking.createdAt)}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={booking.status} />
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full border px-2 py-1 text-xs font-semibold ${
                        booking.paymentStatus === "CONFIRMADO"
                          ? "border-emerald-400/50 bg-emerald-400/15 text-emerald-200"
                          : "border-amber-400/50 bg-amber-500/15 text-amber-100"
                      }`}
                    >
                      {booking.paymentStatus}
                    </span>
                  </td>
                </tr>
              ))}
              {recentBookings.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-zinc-500">
                    Nenhum registro recente.
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
