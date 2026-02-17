"use client";

import { useMemo, useState, useTransition } from "react";
import {
  adminLogoutAction,
  createBlockedSlotAction,
  deleteBlockedSlotAction,
  updateBookingStatusAction,
  updateServiceAction,
} from "@/lib/actions/booking-actions";
import { Barber, BlockedSlot, BookingWithRelations, Service } from "@/types/domain";
import { useToast } from "@/components/ui/toast";
import { StatusBadge } from "@/components/ui/status-badge";

type AdminDashboardProps = {
  bookings: BookingWithRelations[];
  barbers: Barber[];
  blockedSlots: BlockedSlot[];
  services: Service[];
};

function formatPriceInput(priceCents: number): string {
  return (priceCents / 100).toFixed(2).replace(".", ",");
}

function parsePriceToCents(value: string): number {
  const normalized = value.replace("R$", "").trim().replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return NaN;
  }
  return Math.round(parsed * 100);
}

export function AdminDashboard({ bookings, barbers, blockedSlots, services }: AdminDashboardProps) {
  const [isPending, startTransition] = useTransition();
  const { pushToast } = useToast();

  const [dateFilter, setDateFilter] = useState("");
  const [barberFilter, setBarberFilter] = useState("TODOS");
  const [statusFilter, setStatusFilter] = useState("TODOS");

  const [serviceForm, setServiceForm] = useState<Record<string, { name: string; price: string }>>(
    () =>
      Object.fromEntries(
        services.map((service) => [service.id, { name: service.name, price: formatPriceInput(service.priceCents) }]),
      ),
  );

  const [blockForm, setBlockForm] = useState({
    barberId: "",
    dateTimeStart: "",
    dateTimeEnd: "",
    reason: "",
  });

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

  function logout() {
    startTransition(async () => {
      await adminLogoutAction();
      window.location.reload();
    });
  }

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

  function submitService(serviceId: string) {
    const form = serviceForm[serviceId];
    if (!form) {
      pushToast("Servico invalido", "error");
      return;
    }

    const priceCents = parsePriceToCents(form.price);
    if (!form.name.trim() || !Number.isFinite(priceCents)) {
      pushToast("Preencha nome e preco valido", "error");
      return;
    }

    startTransition(async () => {
      try {
        await updateServiceAction({
          serviceId,
          name: form.name.trim(),
          priceCents,
        });
        pushToast("Servico atualizado", "success");
        window.location.reload();
      } catch (error) {
        pushToast(error instanceof Error ? error.message : "Erro ao atualizar servico", "error");
      }
    });
  }

  function submitBlock() {
    startTransition(async () => {
      try {
        await createBlockedSlotAction({
          barberId: blockForm.barberId || undefined,
          dateTimeStart: new Date(blockForm.dateTimeStart).toISOString(),
          dateTimeEnd: new Date(blockForm.dateTimeEnd).toISOString(),
          reason: blockForm.reason,
        });
        pushToast("Bloqueio criado", "success");
        window.location.reload();
      } catch (error) {
        pushToast(error instanceof Error ? error.message : "Erro ao bloquear", "error");
      }
    });
  }

  function removeBlock(blockedSlotId: string) {
    startTransition(async () => {
      try {
        await deleteBlockedSlotAction({ blockedSlotId });
        pushToast("Bloqueio removido", "success");
        window.location.reload();
      } catch (error) {
        pushToast(error instanceof Error ? error.message : "Erro ao remover bloqueio", "error");
      }
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[260px_1fr] lg:items-start">
      <aside className="rounded-2xl border border-zinc-800 bg-zinc-900/80 p-4 lg:sticky lg:top-6">
        <div className="rounded-xl border border-zinc-700/80 bg-zinc-950/80 p-4">
          <p className="text-xs uppercase tracking-[0.22em] text-cyan-300">ALFA BARBER</p>
          <h1 className="mt-2 text-xl font-semibold text-zinc-100">Painel Admin</h1>
          <p className="mt-1 text-xs text-zinc-400">Gestao operacional</p>
        </div>

        <nav className="mt-4 space-y-2 text-sm">
          <a href="#servicos" className="block rounded-lg border border-zinc-700 bg-zinc-950/70 px-3 py-2 text-zinc-200 transition hover:border-cyan-400/50 hover:text-cyan-200">
            Servicos
          </a>
          <a href="#agenda" className="block rounded-lg border border-zinc-700 bg-zinc-950/70 px-3 py-2 text-zinc-200 transition hover:border-cyan-400/50 hover:text-cyan-200">
            Agenda
          </a>
          <a href="#bloqueios" className="block rounded-lg border border-zinc-700 bg-zinc-950/70 px-3 py-2 text-zinc-200 transition hover:border-cyan-400/50 hover:text-cyan-200">
            Bloqueios
          </a>
        </nav>

        <button
          type="button"
          onClick={logout}
          disabled={isPending}
          className="mt-4 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-4 py-2 text-sm font-medium text-zinc-200 transition hover:border-zinc-500 disabled:opacity-60"
        >
          Sair
        </button>
      </aside>

      <section className="space-y-6">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 px-4 py-4 sm:px-5">
          <h2 className="text-xl font-semibold text-zinc-100 sm:text-2xl">Dashboard Admin</h2>
          <p className="mt-1 text-sm text-zinc-400">Gerencie servicos, acompanhe agendamentos e controle bloqueios de agenda.</p>
        </div>

        <section id="servicos" className="scroll-mt-6 rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5">
          <h3 className="text-xl font-semibold text-zinc-100">Servicos</h3>
          <p className="mt-1 text-sm text-zinc-400">Edite nome e preco dos servicos exibidos para os clientes.</p>

          <div className="mt-4 space-y-3">
            {services.map((service) => (
              <div key={service.id} className="grid gap-2 rounded-lg border border-zinc-700 bg-zinc-950/70 p-3 md:grid-cols-[1fr_180px_auto]">
                <input
                  type="text"
                  value={serviceForm[service.id]?.name ?? ""}
                  onChange={(event) =>
                    setServiceForm((prev) => ({
                      ...prev,
                      [service.id]: {
                        ...(prev[service.id] ?? { name: "", price: "" }),
                        name: event.target.value,
                      },
                    }))
                  }
                  className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
                />
                <input
                  type="text"
                  value={serviceForm[service.id]?.price ?? ""}
                  onChange={(event) =>
                    setServiceForm((prev) => ({
                      ...prev,
                      [service.id]: {
                        ...(prev[service.id] ?? { name: "", price: "" }),
                        price: event.target.value,
                      },
                    }))
                  }
                  placeholder="0,00"
                  className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
                />
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => submitService(service.id)}
                  className="w-full rounded-lg bg-cyan-400 px-4 py-2 text-sm font-bold text-zinc-950 disabled:opacity-70 md:w-auto"
                >
                  Salvar
                </button>
              </div>
            ))}
          </div>
        </section>

        <section id="agenda" className="scroll-mt-6 space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5">
          <h3 className="text-xl font-semibold text-zinc-100">Agenda</h3>

          <div className="grid gap-3 rounded-xl border border-zinc-800 bg-zinc-950/50 p-4 md:grid-cols-3">
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
                    <td className="whitespace-nowrap px-3 py-2 text-zinc-300">{new Date(booking.dateTimeStart).toLocaleString("pt-BR")}</td>
                    <td className="px-3 py-2"><StatusBadge status={booking.status} /></td>
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

        <section id="bloqueios" className="scroll-mt-6 grid gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
            <h3 className="text-xl font-semibold text-zinc-100">Novo bloqueio</h3>
            <div className="mt-4 space-y-3">
              <select
                value={blockForm.barberId}
                onChange={(event) => setBlockForm((prev) => ({ ...prev, barberId: event.target.value }))}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
              >
                <option value="">Todos os barbeiros</option>
                {barbers.map((barber) => (
                  <option key={barber.id} value={barber.id}>
                    {barber.name}
                  </option>
                ))}
              </select>
              <input
                type="datetime-local"
                value={blockForm.dateTimeStart}
                onChange={(event) => setBlockForm((prev) => ({ ...prev, dateTimeStart: event.target.value }))}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
              />
              <input
                type="datetime-local"
                value={blockForm.dateTimeEnd}
                onChange={(event) => setBlockForm((prev) => ({ ...prev, dateTimeEnd: event.target.value }))}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
              />
              <input
                type="text"
                value={blockForm.reason}
                onChange={(event) => setBlockForm((prev) => ({ ...prev, reason: event.target.value }))}
                placeholder="Motivo"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
              />
              <button
                type="button"
                disabled={isPending}
                onClick={submitBlock}
                className="rounded-lg bg-cyan-400 px-4 py-2 text-sm font-bold text-zinc-950 disabled:opacity-70"
              >
                Salvar bloqueio
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
            <h3 className="text-xl font-semibold text-zinc-100">Bloqueios ativos</h3>
            <ul className="mt-4 space-y-2 text-sm">
              {blockedSlots.map((blocked) => (
                <li key={blocked.id} className="rounded-lg border border-zinc-700 bg-zinc-950/70 p-3 text-zinc-300">
                  <p>
                    {new Date(blocked.dateTimeStart).toLocaleString("pt-BR")} - {new Date(blocked.dateTimeEnd).toLocaleString("pt-BR")}
                  </p>
                  <p className="text-zinc-400">{blocked.reason}</p>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => removeBlock(blocked.id)}
                    className="mt-2 rounded border border-red-400/60 px-2 py-1 text-xs text-red-200"
                  >
                    Remover
                  </button>
                </li>
              ))}
              {blockedSlots.length === 0 && <li className="text-zinc-500">Sem bloqueios cadastrados.</li>}
            </ul>
          </div>
        </section>
      </section>
    </div>
  );
}
