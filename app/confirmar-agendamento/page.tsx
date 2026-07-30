import Link from "next/link";
import { headers } from "next/headers";
import { ConfirmBookingForm } from "@/components/scheduler/confirm-booking-form";
import {
  getBookingByConfirmationToken,
  getPublicConfirmationState,
} from "@/lib/booking-service";
import { BUSINESS_CONFIG } from "@/lib/config";
import { formatDateTimeInTimeZone } from "@/lib/utils";
import { getClientIpFromHeaders, registerRateLimitEvent } from "@/lib/security";

export const metadata = {
  title: "Confirmar Agendamento | ALFA Barber",
};

const UNAVAILABLE_MESSAGE =
  "Não foi possível validar este link. Verifique a mensagem recebida ou fale com a barbearia pelo WhatsApp.";

export default async function ConfirmarAgendamentoPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token: rawToken = "" } = await searchParams;
  const token = rawToken.trim();
  const requestHeaders = await headers();
  const rateLimit = await registerRateLimitEvent({
    scope: "booking-confirmation-page-ip",
    identifier: getClientIpFromHeaders(requestHeaders),
    windowSeconds: 15 * 60,
    maxAttempts: 30,
  });
  const booking =
    !rateLimit.blocked && token.length >= 32 && token.length <= 256
      ? await getBookingByConfirmationToken(token)
      : undefined;
  const state = getPublicConfirmationState(booking);

  return (
    <div className="min-h-screen">
      <main className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
        <h1 className="text-3xl font-bold text-zinc-100 sm:text-4xl">Confirmar agendamento</h1>

        {!state.valid ? (
          <section className="mt-6 rounded-xl border border-brand/40 bg-brand/10 p-5 text-brand-soft">
            {UNAVAILABLE_MESSAGE}
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
