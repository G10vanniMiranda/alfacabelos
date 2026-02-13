import Link from "next/link";
import { redirect } from "next/navigation";
import { SiteHeader } from "@/components/ui/site-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { cancelMyBookingAction, getCurrentClient } from "@/lib/actions/client-auth-actions";
import { listClientBookings } from "@/lib/booking-service";

export const metadata = {
  title: "Minha Area | ALFA Barber",
};

function formatDateTime(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(iso));
}

export default async function ClientAreaPage() {
  const client = await getCurrentClient();
  if (!client) {
    redirect("/cliente/login?next=/cliente");
  }

  const bookings = await listClientBookings(client.phone);
  const upcoming = bookings
    .filter((booking) => booking.status !== "CANCELADO")
    .sort((a, b) => new Date(a.dateTimeStart).getTime() - new Date(b.dateTimeStart).getTime());

  const history = bookings
    .filter((booking) => booking.status === "CANCELADO")
    .sort((a, b) => new Date(b.dateTimeStart).getTime() - new Date(a.dateTimeStart).getTime());

  return (
    <div className="min-h-screen pb-12">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-4xl font-bold text-zinc-100">Minha area</h1>
            <p className="mt-2 text-zinc-400">Acompanhe e gerencie seus agendamentos.</p>
          </div>
          <Link
            href="/agendar"
            className="rounded-md bg-cyan-400 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-cyan-300"
          >
            Novo agendamento
          </Link>
        </div>

        <section className="mt-8">
          <h2 className="text-2xl font-semibold text-zinc-100">Proximos agendamentos</h2>
          {upcoming.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-400">Voce nao tem agendamentos futuros.</p>
          ) : (
            <div className="mt-4 grid gap-3">
              {upcoming.map((booking) => (
                <article
                  key={booking.id}
                  className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4 sm:flex sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="text-base font-semibold text-zinc-100">{booking.service.name}</p>
                    <p className="mt-1 text-sm text-zinc-400">Barbeiro: {booking.barber.name}</p>
                    <p className="mt-1 text-sm text-zinc-300">{formatDateTime(booking.dateTimeStart)}</p>
                  </div>
                  <div className="mt-3 flex items-center gap-2 sm:mt-0">
                    <StatusBadge status={booking.status} />
                    <form action={cancelMyBookingAction}>
                      <input type="hidden" name="bookingId" value={booking.id} />
                      <button
                        type="submit"
                        className="rounded-md border border-red-500/60 px-3 py-2 text-xs font-semibold text-red-200 transition hover:bg-red-500/15"
                      >
                        Cancelar
                      </button>
                    </form>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="mt-10">
          <h2 className="text-2xl font-semibold text-zinc-100">Historico</h2>
          {history.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-400">Nenhum atendimento anterior encontrado.</p>
          ) : (
            <div className="mt-4 grid gap-3">
              {history.map((booking) => (
                <article
                  key={booking.id}
                  className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 sm:flex sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="text-base font-semibold text-zinc-100">{booking.service.name}</p>
                    <p className="mt-1 text-sm text-zinc-400">Barbeiro: {booking.barber.name}</p>
                    <p className="mt-1 text-sm text-zinc-300">{formatDateTime(booking.dateTimeStart)}</p>
                  </div>
                  <div className="mt-3 sm:mt-0">
                    <StatusBadge status={booking.status} />
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
