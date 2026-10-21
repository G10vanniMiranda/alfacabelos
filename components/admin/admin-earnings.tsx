 "use client";

import { useRef } from "react";
import type { EarningsData } from "@/lib/booking-query-service";
import { Barber } from "@/types/domain";
import { BUSINESS_CONFIG } from "@/lib/config";
import { formatBRLFromCents, formatDateTimeInTimeZone } from "@/lib/utils";

type AdminEarningsProps = {
  from: string;
  to: string;
  barberId: string;
  barbers: Barber[];
  earnings: EarningsData;
};

type DateInputWithPickerProps = {
  name: string;
  defaultValue: string;
};

type DateInputElement = HTMLInputElement & {
  showPicker?: () => void;
};

function formatDateTime(iso: string) {
  return formatDateTimeInTimeZone(iso, BUSINESS_CONFIG.timezone);
}

function DateInputWithPicker({ name, defaultValue }: DateInputWithPickerProps) {
  const inputRef = useRef<DateInputElement | null>(null);

  function openPicker() {
    inputRef.current?.showPicker?.();
    inputRef.current?.focus();
  }

  return (
    <div className="ui-control relative">
      <input
        ref={inputRef}
        type="date"
        name={name}
        defaultValue={defaultValue}
        className="w-full bg-transparent px-3 py-2 pr-12 text-zinc-100 outline-none [&::-webkit-calendar-picker-indicator]:opacity-0"
      />
      <button
        type="button"
        onClick={openPicker}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md border border-zinc-600 px-2 py-1 text-sm text-zinc-200 transition hover:border-brand/60 hover:text-brand-highlight"
        aria-label={`Abrir calendario de ${name === "from" ? "data inicial" : "data final"}`}
      >
        Abrir
      </button>
    </div>
  );
}

export function AdminEarnings({
  from,
  to,
  barberId,
  barbers,
  earnings,
}: AdminEarningsProps) {
  const averageTicketCents = earnings.confirmedCount > 0
    ? Math.round(earnings.totalConfirmedCents / earnings.confirmedCount)
    : 0;

  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 px-4 py-4 sm:px-5">
        <h2 className="text-xl font-semibold text-zinc-100 sm:text-2xl">Controle de ganhos</h2>
        <p className="mt-1 text-sm text-zinc-400">Acompanhe os recebimentos confirmados e o que ainda aguarda pagamento.</p>
      </div>

      <form className="grid gap-3 rounded-xl border border-zinc-800 bg-zinc-900/70 p-4 md:grid-cols-[180px_180px_1fr_auto]">
        <DateInputWithPicker name="from" defaultValue={from} />
        <DateInputWithPicker name="to" defaultValue={to} />
        <select
          name="barberId"
          defaultValue={barberId}
          className="ui-control px-3 py-2"
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
          className="button-primary px-4 py-2"
        >
          Aplicar
        </button>
      </form>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-zinc-400">Faturamento</p>
          <p className="mt-2 text-2xl font-black text-success-soft">{formatBRLFromCents(earnings.totalConfirmedCents)}</p>
          <p className="mt-1 text-sm text-zinc-400">apenas pagamentos confirmados</p>
        </article>
        <article className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-zinc-400">Previsao</p>
          <p className="mt-2 text-2xl font-black text-warning">{formatBRLFromCents(earnings.pendingPotentialCents)}</p>
          <p className="mt-1 text-sm text-zinc-400">valor aguardando confirmação de pagamento</p>
        </article>
        <article className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-zinc-400">Atendimentos</p>
          <p className="mt-2 text-2xl font-black text-zinc-100">{earnings.confirmedCount}</p>
          <p className="mt-1 text-sm text-zinc-400">pagamentos confirmados no período</p>
        </article>
        <article className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-zinc-400">Ticket medio</p>
          <p className="mt-2 text-2xl font-black text-zinc-100">{formatBRLFromCents(averageTicketCents)}</p>
          <p className="mt-1 text-sm text-zinc-400">média por pagamento confirmado</p>
        </article>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5">
          <h3 className="text-lg font-semibold text-zinc-100">Ganhos por dia</h3>
          <div className="mt-4 space-y-2">
            {earnings.dailyRevenue.map((item) => (
              <article key={item.key} className="rounded-lg border border-zinc-700 bg-zinc-950/70 p-3">
                <p className="font-semibold text-zinc-100">{item.label}</p>
                <p className="mt-1 text-sm text-brand-highlight">{formatBRLFromCents(item.totalCents)}</p>
                <p className="mt-1 text-xs text-copy-muted">{item.bookingsCount} pagamento(s) confirmado(s)</p>
              </article>
            ))}
            {earnings.dailyRevenue.length === 0 ? <p className="text-sm text-copy-muted">Sem faturamento no período.</p> : null}
          </div>
        </section>

        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5">
          <h3 className="text-lg font-semibold text-zinc-100">Ganhos por serviço</h3>
          <div className="mt-4 space-y-2">
            {earnings.serviceRevenue.map((item) => (
              <article key={item.key} className="rounded-lg border border-zinc-700 bg-zinc-950/70 p-3">
                <p className="font-semibold text-zinc-100">{item.label}</p>
                <p className="mt-1 text-sm text-brand-highlight">{formatBRLFromCents(item.totalCents)}</p>
                <p className="mt-1 text-xs text-copy-muted">{item.bookingsCount} pagamento(s) confirmado(s)</p>
              </article>
            ))}
            {earnings.serviceRevenue.length === 0 ? <p className="text-sm text-copy-muted">Sem serviços pagos no período.</p> : null}
          </div>
        </section>

        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5">
          <h3 className="text-lg font-semibold text-zinc-100">Ganhos por barbeiro</h3>
          <div className="mt-4 space-y-2">
            {earnings.barberRevenue.map((item) => (
              <article key={item.key} className="rounded-lg border border-zinc-700 bg-zinc-950/70 p-3">
                <p className="font-semibold text-zinc-100">{item.label}</p>
                <p className="mt-1 text-sm text-brand-highlight">{formatBRLFromCents(item.totalCents)}</p>
                <p className="mt-1 text-xs text-copy-muted">{item.bookingsCount} pagamento(s) confirmado(s)</p>
              </article>
            ))}
            {earnings.barberRevenue.length === 0 ? <p className="text-sm text-copy-muted">Sem barbeiros com ganhos no período.</p> : null}
          </div>
        </section>
      </div>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5">
        <h3 className="text-lg font-semibold text-zinc-100">Últimos recebimentos confirmados</h3>
        <div className="ui-table-shell mt-4">
          <table className="w-full min-w-190 text-left text-sm">
            <thead className="text-zinc-400">
              <tr>
                <th scope="col" className="px-2 py-2">Cliente</th>
                <th scope="col" className="px-2 py-2">Serviço</th>
                <th scope="col" className="px-2 py-2">Barbeiro</th>
                <th scope="col" className="px-2 py-2">Data</th>
                <th scope="col" className="px-2 py-2">Valor</th>
              </tr>
            </thead>
            <tbody>
              {earnings.recentConfirmedBookings.map((booking) => (
                  <tr key={booking.id} className="border-t border-zinc-800 text-zinc-200">
                    <td className="px-2 py-2">{booking.customerName}</td>
                    <td className="px-2 py-2">{booking.service.name}</td>
                    <td className="px-2 py-2">{booking.barber.name}</td>
                    <td className="px-2 py-2 text-zinc-400">{formatDateTime(booking.paymentConfirmedAt ?? booking.dateTimeStart)}</td>
                    <td className="px-2 py-2 text-success-soft">{formatBRLFromCents(booking.service.priceCents)}</td>
                  </tr>
                ))}
              {earnings.recentConfirmedBookings.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-2 py-4 text-center text-copy-muted">
                    Nenhum recebimento confirmado no período selecionado.
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
