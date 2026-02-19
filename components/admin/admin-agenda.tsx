"use client";

import { useMemo, useState, useTransition } from "react";
import { updateBookingStatusAction } from "@/lib/actions/booking-actions";
import { DateCalendar } from "@/components/scheduler/date-calendar";
import { useToast } from "@/components/ui/toast";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDateInput } from "@/lib/utils";
import { Barber, BookingWithRelations } from "@/types/domain";

type AdminAgendaProps = {
  bookings: BookingWithRelations[];
  barbers: Barber[];
};

export function AdminAgenda({ bookings, barbers }: AdminAgendaProps) {
  const [isPending, startTransition] = useTransition();
  const { pushToast } = useToast();

  const [dateFilter, setDateFilter] = useState(() => formatDateInput(new Date()));
  const [barberFilter, setBarberFilter] = useState("TODOS");
  const [statusFilter, setStatusFilter] = useState("TODOS");

  const minCalendarDate = useMemo(() => {
    if (bookings.length === 0) {
      return formatDateInput(new Date());
    }

    let minDate = bookings[0]?.dateTimeStart.slice(0, 10) ?? formatDateInput(new Date());
    for (const booking of bookings) {
      const day = booking.dateTimeStart.slice(0, 10);
      if (day < minDate) {
        minDate = day;
      }
    }
    return minDate;
  }, [bookings]);

  const filtered = useMemo(() => {
    return bookings.filter((booking) => {
      if (dateFilter && !booking.dateTimeStart.startsWith(dateFilter)) {
        return false;
      }
      if (barberFilter !== "TODOS" && booking.barberId !== barberFilter) {
        return false;
      }
      if (statusFilter !== "TODOS" && booking.status !== statusFilter) {
        return false;
      }
      return true;
    });
  }, [bookings, dateFilter, barberFilter, statusFilter]);

  function changeStatus(bookingId: string, status: "PENDENTE" | "CONFIRMADO" | "CANCELADO") {
    startTransition(async () => {
      try {
        await updateBookingStatusAction({ bookingId, status });
        pushToast("Status atualizado", "success");
        window.location.reload();
      } catch (error) {
        pushToast(error instanceof Error ? error.message : "Erro ao atualizar", "error");
      }
    });
  }

  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 px-4 py-4 sm:px-5">
        <h2 className="text-xl font-semibold text-zinc-100 sm:text-2xl">Agenda</h2>
        <p className="mt-1 text-sm text-zinc-400">Acompanhe e atualize os agendamentos.</p>
      </div>

      <div className="grid gap-4 rounded-xl border border-zinc-800 bg-zinc-900/70 p-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div>
          <p className="text-sm text-zinc-300">Selecione o dia</p>
          <DateCalendar
            minDate={minCalendarDate}
            maxMonthsForward={24}
            selectedDate={dateFilter}
            onSelect={setDateFilter}
          />
        </div>

        <div>
          <p className="text-sm text-zinc-300">Filtros</p>
          <div className="mt-2 rounded-xl border border-zinc-800 bg-zinc-950/60 p-3 sm:p-4">
            <div className="space-y-3">
              <select
                value={barberFilter}
                onChange={(event) => setBarberFilter(event.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
              >
                <option value="TODOS">Todos os barbeiros</option>
                {barbers.map((barber) => (
                  <option key={barber.id} value={barber.id}>
                    {barber.name}
                  </option>
                ))}
              </select>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
              >
                <option value="TODOS">Todos os status</option>
                <option value="PENDENTE">PENDENTE</option>
                <option value="CONFIRMADO">CONFIRMADO</option>
                <option value="CANCELADO">CANCELADO</option>
              </select>
              <button
                type="button"
                onClick={() => setDateFilter(formatDateInput(new Date()))}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 transition hover:border-cyan-400/60"
              >
                Ir para hoje
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-zinc-800">
        <table className="w-full min-w-190 text-left text-sm">
          <thead className="bg-zinc-900 text-zinc-300">
            <tr>
              <th className="px-3 py-2">Cliente</th>
              <th className="px-3 py-2">Serviço</th>
              <th className="px-3 py-2">Barbeiro</th>
              <th className="px-3 py-2">Horário</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Ações</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((booking) => (
              <tr key={booking.id} className="border-t border-zinc-800 bg-zinc-950/40">
                <td className="px-3 py-2 text-zinc-200">
                  {booking.customerName}
                  <p className="text-xs text-zinc-500">{booking.customerPhone}</p>
                </td>
                <td className="px-3 py-2 text-zinc-200">{booking.service.name}</td>
                <td className="px-3 py-2 text-zinc-200">{booking.barber.name}</td>
                <td className="whitespace-nowrap px-3 py-2 text-zinc-300">
                  {new Date(booking.dateTimeStart).toLocaleString("pt-BR")}
                </td>
                <td className="px-3 py-2">
                  <StatusBadge status={booking.status} />
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => changeStatus(booking.id, "CONFIRMADO")}
                      className="rounded border border-emerald-400/50 px-2 py-1 text-xs text-emerald-200"
                    >
                      Confirmar
                    </button>
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => changeStatus(booking.id, "CANCELADO")}
                      className="rounded border border-red-400/60 px-2 py-1 text-xs text-red-200"
                    >
                      Cancelar
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-5 text-center text-zinc-500">
                  Nenhum agendamento encontrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
