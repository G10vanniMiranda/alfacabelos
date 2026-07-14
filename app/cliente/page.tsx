import Link from "next/link";
import { redirect } from "next/navigation";
import { ClientBookingActions } from "@/components/client/client-booking-actions";
import { StatusBadge } from "@/components/ui/status-badge";
import { getCurrentClient, logoutClientAction, updateMyProfileAction } from "@/lib/actions/client-auth-actions";
import { listClientBookings } from "@/lib/booking-service";
import { BUSINESS_CONFIG } from "@/lib/config";
import { formatBRLFromCents, formatDateTimeInTimeZone } from "@/lib/utils";
import { buildBookingWhatsAppUrl } from "@/lib/whatsapp";
import type { BookingWithRelations } from "@/types/domain";

export const metadata = { title: "Minha área" };

function formatDateTime(iso: string) {
  return formatDateTimeInTimeZone(iso, BUSINESS_CONFIG.timezone);
}

function getCurrentTimestamp() {
  return Date.now();
}

function rebookHref(booking: BookingWithRelations) {
  return `/agendar?bookingId=${encodeURIComponent(booking.id)}&serviceId=${encodeURIComponent(booking.serviceId)}&barberId=${encodeURIComponent(booking.barberId)}`;
}

function BookingCard({ booking, featured = false, canManage = true }: { booking: BookingWithRelations; featured?: boolean; canManage?: boolean }) {
  return (
    <article className={`rounded-2xl border p-5 ${featured ? "border-amber-200/30 bg-amber-200/[0.06]" : "border-white/[0.08] bg-white/[0.025]"}`}>
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold text-stone-100">{booking.service.name}</h3>
            <StatusBadge status={booking.status} />
          </div>
          <p className="mt-3 text-base font-semibold capitalize text-amber-100">{formatDateTime(booking.dateTimeStart)}</p>
          <p className="mt-1 text-sm text-stone-400">com {booking.barber.name} • {booking.service.durationMinutes} min • {formatBRLFromCents(booking.service.priceCents)}</p>
        </div>
        {featured ? <span className="w-fit rounded-full border border-amber-200/25 bg-amber-200/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-amber-100">Próximo</span> : null}
      </div>
      <div className="mt-5 border-t border-white/[0.08] pt-4">
        <ClientBookingActions bookingId={booking.id} status={booking.status} rebookHref={rebookHref(booking)} whatsappHref={buildBookingWhatsAppUrl(booking)} canManage={canManage} />
      </div>
    </article>
  );
}

export default async function ClientAreaPage() {
  const client = await getCurrentClient();
  if (!client) redirect("/cliente/login?next=/cliente&reason=session-expired");

  const bookings = await listClientBookings(client.id);
  const now = getCurrentTimestamp();
  const upcoming = bookings
    .filter((booking) => booking.status !== "CANCELADO" && new Date(booking.dateTimeStart).getTime() >= now)
    .sort((a, b) => new Date(a.dateTimeStart).getTime() - new Date(b.dateTimeStart).getTime());
  const history = bookings
    .filter((booking) => booking.status === "CANCELADO" || new Date(booking.dateTimeStart).getTime() < now)
    .sort((a, b) => new Date(b.dateTimeStart).getTime() - new Date(a.dateTimeStart).getTime());
  const nextBooking = upcoming[0];

  return (
    <main id="conteudo" className="shell py-8 sm:py-12">
      <header className="flex flex-col gap-5 border-b border-white/[0.08] pb-7 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow">Área do cliente</p>
          <h1 className="mt-3 text-3xl font-semibold text-stone-100 sm:text-5xl">Olá, {client.name.split(" ")[0]}.</h1>
          <p className="mt-2 text-stone-400">Sua agenda e seus cuidados em um só lugar.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/" className="button-ghost">Início</Link>
          <Link href="/agendar" className="button-primary">Novo agendamento</Link>
        </div>
      </header>

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="min-w-0">
          <section aria-labelledby="proximo-agendamento">
            <div className="flex items-end justify-between gap-3">
              <div><p className="eyebrow">Sua agenda</p><h2 id="proximo-agendamento" className="mt-2 text-2xl font-semibold text-stone-100">Próximo agendamento</h2></div>
              <span className="text-sm text-stone-500">{upcoming.length} futuro{upcoming.length === 1 ? "" : "s"}</span>
            </div>
            <div className="mt-4">
              {nextBooking ? <BookingCard booking={nextBooking} featured /> : (
                <div className="rounded-2xl border border-dashed border-white/15 bg-white/[0.02] p-7 text-center">
                  <span className="mx-auto grid size-12 place-items-center rounded-full bg-amber-200/10 text-xl text-amber-200" aria-hidden="true">✦</span>
                  <h3 className="mt-4 text-lg font-semibold text-stone-100">Sua agenda está livre.</h3>
                  <p className="mt-2 text-sm text-stone-400">Você ainda não possui agendamentos. Escolha seu próximo horário.</p>
                  <Link href="/agendar" className="button-primary mt-5">Escolher horário</Link>
                </div>
              )}
            </div>
            {upcoming.length > 1 ? <div className="mt-3 grid gap-3">{upcoming.slice(1).map((booking) => <BookingCard key={booking.id} booking={booking} />)}</div> : null}
          </section>

          <section className="mt-10" aria-labelledby="historico">
            <h2 id="historico" className="text-2xl font-semibold text-stone-100">Histórico</h2>
            <p className="mt-1 text-sm text-stone-500">Atendimentos anteriores e cancelamentos.</p>
            {history.length ? <div className="mt-4 grid gap-3">{history.map((booking) => <BookingCard key={booking.id} booking={booking} canManage={false} />)}</div> : (
              <p className="mt-4 rounded-2xl border border-dashed border-white/15 p-5 text-sm text-stone-400">Seu histórico aparecerá aqui após o primeiro atendimento.</p>
            )}
          </section>
        </div>

        <aside className="space-y-4">
          <section className="premium-card rounded-2xl p-5">
            <p className="eyebrow">Meus dados</p>
            <form action={updateMyProfileAction} className="mt-4 space-y-3">
              <label className="block text-xs text-stone-500">Nome<input name="name" defaultValue={client.name} minLength={2} required className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-stone-100" /></label>
              <label className="block text-xs text-stone-500">Telefone<input name="phone" defaultValue={client.phone} minLength={10} required className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-stone-100" /></label>
              <button type="submit" className="button-secondary w-full">Salvar meus dados</button>
            </form>
            <Link href="/esqueci-minha-senha" className="mt-4 inline-block text-sm font-semibold text-amber-200 hover:text-amber-100">Alterar minha senha →</Link>
          </section>
          <section className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5">
            <h2 className="font-semibold text-stone-100">Precisa de ajuda?</h2>
            <p className="mt-2 text-sm leading-6 text-stone-400">Para reagendar ou tirar dúvidas, fale diretamente com nossa equipe.</p>
            <p className="mt-4 text-xs leading-5 text-stone-500">Cancelamentos liberam o horário imediatamente. Avise com a maior antecedência possível.</p>
          </section>
          <form action={logoutClientAction}><button type="submit" className="button-secondary w-full">Sair da conta</button></form>
        </aside>
      </div>
    </main>
  );
}
