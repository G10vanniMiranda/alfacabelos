"use client";

import { useMemo, useState, useTransition } from "react";
import { updateBookingStatusAction } from "@/lib/actions/booking-actions";
import { useToast } from "@/components/ui/toast";
import { StatusBadge } from "@/components/ui/status-badge";
import { Barber, BookingWithRelations } from "@/types/domain";

type AdminAgendaProps = {
  bookings: BookingWithRelations[];
  barbers: Barber[];
};

export function AdminAgenda({ bookings, barbers }: AdminAgendaProps) {
  const [isPending, startTransition] = useTransition();
  const { pushToast } = useToast();

  const [dateFilter, setDateFilter] = useState("");
  const [barberFilter, setBarberFilter] = useState("TODOS");
  const [statusFilter, setStatusFilter] = useState("TODOS");

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

      <div className="grid gap-3 rounded-xl border border-zinc-800 bg-zinc-900/70 p-4 md:grid-cols-3">
        <input
          type="date"
          value={dateFilter}
          onChange={(event) => setDateFilter(event.target.value)}
          className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
        />
        <select
          value={barberFilter}
          onChange={(event) => setBarberFilter(event.target.value)}
          className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
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
          className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
        >
          <option value="TODOS">Todos os status</option>
          <option value="PENDENTE">PENDENTE</option>
          <option value="CONFIRMADO">CONFIRMADO</option>
          <option value="CANCELADO">CANCELADO</option>
        </select>
      </div>

      <div className="overflow-x-auto rounded-xl border border-zinc-800">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-zinc-900 text-zinc-300">
            <tr>
              <th className="px-3 py-2">Cliente</th>
              <th className="px-3 py-2">Servico</th>
              <th className="px-3 py-2">Barbeiro</th>
              <th className="px-3 py-2">Horario</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Acoes</th>
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
