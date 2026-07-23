import Link from "next/link";
import { ConfirmBookingForm } from "@/components/scheduler/confirm-booking-form";
import {
  getBookingByConfirmationToken,
  getPublicConfirmationState,
} from "@/lib/booking-service";
import { BUSINESS_CONFIG } from "@/lib/config";
import { formatDateTimeInTimeZone } from "@/lib/utils";

export const metadata = {
  title: "Confirmar Agendamento | ALFA Barber",
};

function getUnavailableMessage(reason: "invalid" | "used" | "expired" | "not_pending") {
  if (reason === "used") {
    return "Este link já foi usado. Se você precisa alterar algo, fale com a barbearia pelo WhatsApp.";
  }

  if (reason === "expired") {
    return "Este link expirou. Fale com a barbearia pelo WhatsApp para receber uma nova confirmação.";
  }

  if (reason === "not_pending") {
    return "Este agendamento não está mais pendente. Fale com a barbearia pelo WhatsApp se precisar de ajuda.";
  }

  return "Não foi possível validar este link. Verifique a mensagem recebida ou fale com a barbearia pelo WhatsApp.";
}

export default async function ConfirmarAgendamentoPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token = "" } = await searchParams;
  const booking = token ? await getBookingByConfirmationToken(token) : undefined;
  const state = getPublicConfirmationState(booking);

  return (
    <div className="min-h-screen">
      <main className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
        <h1 className="text-3xl font-bold text-zinc-100 sm:text-4xl">Confirmar agendamento</h1>

        {!state.valid ? (
          <section className="mt-6 rounded-xl border border-brand/40 bg-brand/10 p-5 text-brand-soft">
            {getUnavailableMessage(state.reason)}
          </section>
        ) : (
          <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900/70 p-5 sm:p-6">
            <p className="text-sm font-semibold uppercase tracking-wide text-brand-highlight">Alfa Cabelos</p>
            <div className="mt-5 space-y-2 text-zinc-200">
              <p>
                <span className="text-zinc-400">Serviço:</span> {state.booking.service.name}
              </p>
              <p>
                <span className="text-zinc-400">Barbeiro:</span> {state.booking.barber.name}
              </p>
              <p>
                <span className="text-zinc-400">Data e horário:</span>{" "}
                {formatDateTimeInTimeZone(state.booking.dateTimeStart, BUSINESS_CONFIG.timezone)}
              </p>
            </div>
            <div className="mt-6">
              <ConfirmBookingForm token={token} />
            </div>
          </section>
        )}

        <div className="mt-6">
          <Link href="/agendar" className="button-secondary px-4 py-2">
            Ir para agendamentos
          </Link>
        </div>
      </main>
    </div>
  );
}
