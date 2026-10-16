import Link from "next/link";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { ClientBookingCard } from "@/components/client/client-booking-card";
import { ClientBookingHistory } from "@/components/client/client-booking-history";
import { getCurrentClient, logoutClientAction, updateMyProfileAction } from "@/lib/actions/client-auth-actions";
import { listClientBookingHistory, listUpcomingClientBookings } from "@/lib/booking-query-service";
import { CLIENT_HISTORY_PAGE_SIZE } from "@/lib/query-contracts";

export const metadata = { title: "Minha área" };

export default async function ClientAreaPage() {
  await connection();
  const client = await getCurrentClient();
  if (!client) redirect("/cliente/login?next=/cliente&reason=session-expired");

  const [upcoming, history] = await Promise.all([
    listUpcomingClientBookings(client.id),
    listClientBookingHistory(client.id, { limit: CLIENT_HISTORY_PAGE_SIZE }),
  ]);
  const nextBooking = upcoming.data[0];

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
              <span className="text-sm text-copy-muted">{upcoming.total} futuro{upcoming.total === 1 ? "" : "s"}</span>
            </div>
            <div className="mt-4">
              {nextBooking ? <ClientBookingCard booking={nextBooking} featured /> : (
                <div className="rounded-2xl border border-dashed border-white/15 bg-white/[0.02] p-7 text-center">
                  <span className="mx-auto grid size-12 place-items-center rounded-full bg-brand-highlight/10 text-xl text-brand-highlight" aria-hidden="true">✦</span>
                  <h3 className="mt-4 text-lg font-semibold text-stone-100">Sua agenda está livre.</h3>
                  <p className="mt-2 text-sm text-stone-400">Você ainda não possui agendamentos. Escolha seu próximo horário.</p>
                  <Link href="/agendar" className="button-primary mt-5">Escolher horário</Link>
                </div>
              )}
            </div>
            {upcoming.data.length > 1 ? <div className="mt-3 grid gap-3">{upcoming.data.slice(1).map((booking) => <ClientBookingCard key={booking.id} booking={booking} />)}</div> : null}
          </section>

          <section className="mt-10" aria-labelledby="historico">
            <h2 id="historico" className="text-2xl font-semibold text-stone-100">Histórico</h2>
            <p className="mt-1 text-sm text-copy-muted">Atendimentos anteriores e cancelamentos.</p>
            <ClientBookingHistory initialPage={history} />
          </section>
        </div>

        <aside className="space-y-4">
          <section className="premium-card rounded-2xl p-5">
            <p className="eyebrow">Meus dados</p>
            <form action={updateMyProfileAction} className="mt-4 space-y-3">
              <label className="block text-xs text-copy-muted">Nome<input name="name" defaultValue={client.name} minLength={2} required className="ui-control mt-1 w-full px-3 py-2 text-sm" /></label>
              <label className="block text-xs text-copy-muted">Telefone<input name="phone" defaultValue={client.phone} minLength={10} required className="ui-control mt-1 w-full px-3 py-2 text-sm" /></label>
              <button type="submit" className="button-secondary w-full">Salvar meus dados</button>
            </form>
            <Link href="/esqueci-minha-senha" className="mt-4 inline-block text-sm font-semibold text-brand-highlight hover:text-brand-soft">Alterar minha senha →</Link>
          </section>
          <section className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5">
            <h2 className="font-semibold text-stone-100">Precisa de ajuda?</h2>
            <p className="mt-2 text-sm leading-6 text-stone-400">Para reagendar ou tirar dúvidas, fale diretamente com nossa equipe.</p>
            <p className="mt-4 text-xs leading-5 text-copy-muted">Cancelamentos liberam o horário imediatamente. Avise com a maior antecedência possível.</p>
          </section>
          <form action={logoutClientAction}><button type="submit" className="button-secondary w-full">Sair da conta</button></form>
        </aside>
      </div>
    </main>
  );
}
