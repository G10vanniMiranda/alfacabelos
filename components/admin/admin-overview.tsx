import Link from "next/link";
import { Barber, BlockedSlot, BookingWithRelations, Service } from "@/types/domain";

type AdminOverviewProps = {
  bookings: BookingWithRelations[];
  blockedSlots: BlockedSlot[];
  services: Service[];
  barbers: Barber[];
};

function formatDateTime(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(iso));
}

export function AdminOverview({ bookings, blockedSlots, services, barbers }: AdminOverviewProps) {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  const todayBookings = bookings.filter((booking) => booking.dateTimeStart.slice(0, 10) === today);
  const todayConfirmed = todayBookings.filter((booking) => booking.status === "CONFIRMADO");
  const futureBookings = bookings
    .filter((booking) => booking.status !== "CANCELADO" && new Date(booking.dateTimeStart).getTime() >= now.getTime())
    .sort((a, b) => new Date(a.dateTimeStart).getTime() - new Date(b.dateTimeStart).getTime());
  const recentBookings = bookings
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 6);
  const activeBlocked = blockedSlots.filter((slot) => new Date(slot.dateTimeEnd).getTime() >= now.getTime());

  return (
    <section className="min-w-0 space-y-6">
      <div className="relative overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/70 p-6">
        <div className="absolute -right-20 -top-20 h-48 w-48 rounded-full bg-cyan-500/20 blur-3xl" />
        <p className="text-xs uppercase tracking-[0.24em] text-cyan-300">Visao geral</p>
        <h2 className="mt-2 text-2xl font-bold text-zinc-100 sm:text-3xl">Dashboard do painel</h2>
        <p className="mt-2 text-sm text-zinc-400">
          Controle rapido de operacao, com status da agenda e atalhos para gestao.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-zinc-400">Hoje</p>
          <p className="mt-2 text-3xl font-black text-zinc-100">{todayBookings.length}</p>
          <p className="mt-1 text-sm text-zinc-400">agendamentos no dia</p>
        </article>
        <article className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-zinc-400">Confirmados</p>
          <p className="mt-2 text-3xl font-black text-emerald-300">{todayConfirmed.length}</p>
          <p className="mt-1 text-sm text-zinc-400">confirmações para hoje</p>
        </article>
        <article className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-zinc-400">Catálogo</p>
          <p className="mt-2 text-3xl font-black text-zinc-100">{services.length}</p>
          <p className="mt-1 text-sm text-zinc-400">serviços ativos</p>
        </article>
        <article className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-zinc-400">Bloqueios</p>
          <p className="mt-2 text-3xl font-black text-amber-300">{activeBlocked.length}</p>
          <p className="mt-1 text-sm text-zinc-400">intervalos ativos</p>
        </article>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h3 className="text-lg font-semibold text-zinc-100">Próximos atendimentos</h3>
            <Link href="/admin/agenda" className="text-sm font-semibold text-cyan-300 hover:text-cyan-200">
              Ver agenda
            </Link>
          </div>
          <div className="mt-4 space-y-2">
            {futureBookings.slice(0, 8).map((booking) => (
              <article key={booking.id} className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
                <p className="font-semibold text-zinc-100">{booking.customerName}</p>
                <p className="mt-1 text-sm text-zinc-300">
                  {booking.service.name} com {booking.barber.name}
                </p>
                <p className="mt-1 text-xs text-zinc-400">{formatDateTime(booking.dateTimeStart)}</p>
              </article>
            ))}
            {futureBookings.length === 0 && <p className="text-sm text-zinc-500">Sem atendimentos futuros.</p>}
          </div>
        </section>

        <section className="space-y-4">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5">
            <h3 className="text-lg font-semibold text-zinc-100">Atalhos</h3>
            <div className="mt-4 grid gap-2">
              <Link
                href="/admin/servicos"
                className="rounded-lg border border-zinc-700 bg-zinc-950/60 px-3 py-2 text-sm text-zinc-200 transition hover:border-cyan-400/60 hover:text-cyan-200"
              >
                Gerenciar servicos
              </Link>
              <Link
                href="/admin/agenda"
                className="rounded-lg border border-zinc-700 bg-zinc-950/60 px-3 py-2 text-sm text-zinc-200 transition hover:border-cyan-400/60 hover:text-cyan-200"
              >
                Atualizar status da agenda
              </Link>
              <Link
                href="/admin/bloqueios"
                className="rounded-lg border border-zinc-700 bg-zinc-950/60 px-3 py-2 text-sm text-zinc-200 transition hover:border-cyan-400/60 hover:text-cyan-200"
              >
                Configurar bloqueios
              </Link>
              <Link
                href="/admin/galeria"
                className="rounded-lg border border-zinc-700 bg-zinc-950/60 px-3 py-2 text-sm text-zinc-200 transition hover:border-cyan-400/60 hover:text-cyan-200"
              >
                Gerenciar galeria
              </Link>
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5">
            <h3 className="text-lg font-semibold text-zinc-100">Resumo rapido</h3>
            <ul className="mt-3 space-y-2 text-sm text-zinc-300">
              <li>Barbeiros ativos: {barbers.length}</li>
              <li>Agendamentos totais: {bookings.length}</li>
              <li>Ultimos cadastros: {recentBookings.length}</li>
            </ul>
          </div>
        </section>
      </div>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-lg font-semibold text-zinc-100">Atividade recente</h3>
          <span className="text-xs uppercase tracking-[0.16em] text-zinc-500">últimos registros</span>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-zinc-400">
              <tr>
                <th className="px-2 py-2">Cliente</th>
                <th className="px-2 py-2">Serviço</th>
                <th className="px-2 py-2">Criado em</th>
                <th className="px-2 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {recentBookings.map((booking) => (
                <tr key={booking.id} className="border-t border-zinc-800 text-zinc-200">
                  <td className="px-2 py-2">{booking.customerName}</td>
                  <td className="px-2 py-2">{booking.service.name}</td>
                  <td className="px-2 py-2 text-zinc-400">{formatDateTime(booking.createdAt)}</td>
                  <td className="px-2 py-2">{booking.status}</td>
                </tr>
              ))}
              {recentBookings.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-2 py-4 text-center text-zinc-500">
                    Nenhum registro recente.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
