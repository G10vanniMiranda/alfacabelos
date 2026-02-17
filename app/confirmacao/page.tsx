import Link from "next/link";
import { StatusBadge } from "@/components/ui/status-badge";
import { getBookingById } from "@/lib/booking-service";
import { formatBRLFromCents } from "@/lib/utils";

export const metadata = {
  title: "Confirmacao | ALFA Barber",
};

export default async function ConfirmacaoPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id } = await searchParams;
  const booking = id ? await getBookingById(id) : undefined;

  return (
    <div className="min-h-screen">
      <main className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
        <h1 className="text-3xl font-bold text-zinc-100 sm:text-4xl">Confirmação</h1>

        {!booking ? (
          <section className="mt-6 rounded-xl border border-amber-400/40 bg-amber-500/10 p-5 text-amber-100">
            Agendamento não encontrado. Verifique o link de confirmação.
          </section>
        ) : (
          <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900/70 p-5 sm:p-6">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="break-all text-sm text-zinc-400">Codigo: {booking.id}</p>
              <StatusBadge status={booking.status} />
            </div>
            <div className="mt-5 space-y-2 text-zinc-200">
              <p><span className="text-zinc-400">Cliente:</span> {booking.customerName}</p>
              <p><span className="text-zinc-400">Telefone:</span> {booking.customerPhone}</p>
              <p><span className="text-zinc-400">Servico:</span> {booking.service.name}</p>
              <p><span className="text-zinc-400">Preco:</span> {formatBRLFromCents(booking.service.priceCents)}</p>
              <p><span className="text-zinc-400">Barbeiro:</span> {booking.barber.name}</p>
              <p><span className="text-zinc-400">Inicio:</span> {new Date(booking.dateTimeStart).toLocaleString("pt-BR")}</p>
            </div>
          </section>
        )}

        <div className="mt-6">
          <Link href="/agendar" className="rounded-lg bg-cyan-400 px-4 py-2 text-sm font-bold text-zinc-950">
            Novo agendamento
          </Link>
        </div>
      </main>
    </div>
  );
}
