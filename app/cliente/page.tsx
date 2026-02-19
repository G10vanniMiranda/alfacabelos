import Link from "next/link";
import { redirect } from "next/navigation";
import { StatusBadge } from "@/components/ui/status-badge";
import { cancelMyBookingAction, getCurrentClient, logoutClientAction } from "@/lib/actions/client-auth-actions";
import { listClientBookings } from "@/lib/booking-service";

export const metadata = {
  title: "Minha Área | ALFA Barber",
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
    <div className="relative min-h-screen overflow-hidden pb-12">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 right-0 h-72 w-72 rounded-full bg-cyan-500/15 blur-3xl" />
        <div className="absolute bottom-0 left-0 h-80 w-80 rounded-full bg-blue-500/10 blur-3xl" />
      </div>

      <main className="relative mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-cyan-300">Área do cliente</p>
              <h1 className="mt-2 text-3xl font-bold text-zinc-100 sm:text-4xl">Minha agenda</h1>
              <p className="mt-2 text-zinc-400">Acompanhe, confirme e gerencie seus horários em um só lugar.</p>
              <p className="mt-2 text-sm text-zinc-500">{client.name}</p>
            </div>

            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
              <Link
                href="/"
                className="rounded-md border border-zinc-700 px-4 py-2 text-center text-sm font-semibold text-zinc-200 transition hover:border-zinc-500"
              >
                Ir para home
              </Link>
              <Link
                href="/agendar"
                className="rounded-md bg-cyan-400 px-4 py-2 text-center text-sm font-semibold text-zinc-950 transition hover:bg-cyan-300"
              >
                Novo agendamento
              </Link>
              <form action={logoutClientAction}>
                <button
                  type="submit"
                  className="w-full rounded-md border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:border-zinc-500 sm:w-auto"
                >
                  Sair
                </button>
              </form>
            </div>
          </div>
        </section>

        <section className="mt-6 grid gap-3 sm:grid-cols-3">
          <article className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
            <p className="text-xs uppercase tracking-[0.14em] text-zinc-400">Próximos</p>
            <p className="mt-2 text-3xl font-black text-zinc-100">{upcoming.length}</p>
          </article>
          <article className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
            <p className="text-xs uppercase tracking-[0.14em] text-zinc-400">Cancelados</p>
            <p className="mt-2 text-3xl font-black text-amber-300">{history.length}</p>
          </article>
          <article className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
            <p className="text-xs uppercase tracking-[0.14em] text-zinc-400">Total</p>
            <p className="mt-2 text-3xl font-black text-cyan-300">{bookings.length}</p>
          </article>
        </section>

        <section className="mt-10">
          <h2 className="text-2xl font-semibold text-zinc-100">Próximos agendamentos</h2>
          {upcoming.length === 0 ? (
            <p className="mt-4 rounded-xl border border-dashed border-zinc-700 bg-zinc-900/40 p-4 text-sm text-zinc-400">
              Você não tem agendamentos futuros.
            </p>
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
                  <div className="mt-3 flex flex-wrap items-center gap-2 sm:mt-0">
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
          <h2 className="text-2xl font-semibold text-zinc-100">Histórico</h2>
          {history.length === 0 ? (
            <p className="mt-4 rounded-xl border border-dashed border-zinc-700 bg-zinc-900/40 p-4 text-sm text-zinc-400">
              Nenhum atendimento anterior encontrado.
            </p>
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
