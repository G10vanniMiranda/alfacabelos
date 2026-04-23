"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createAdminBookingsAction, updateBookingStatusAction } from "@/lib/actions/booking-actions";
import { DateCalendar } from "@/components/scheduler/date-calendar";
import { StatusBadge } from "@/components/ui/status-badge";
import { useToast } from "@/components/ui/toast";
import { formatBRLFromCents, formatDateInput, formatPhone } from "@/lib/utils";
import { Barber, BookingWithRelations, Service } from "@/types/domain";

type AdminAgendaProps = {
  bookings: BookingWithRelations[];
  barbers: Barber[];
  services: Service[];
};

type RecurrenceOption = "NONE" | "DAILY" | "WEEKLY" | "MONTHLY";

type CreateBookingDraft = {
  serviceId: string;
  barberId: string;
  customerName: string;
  customerPhone: string;
  date: string;
  time: string;
  recurrence: RecurrenceOption;
  repeatUntil: string;
};

function formatTimeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getDefaultDraft(barbers: Barber[], services: Service[], selectedDate: string, selectedBarberId: string) {
  return {
    serviceId: services[0]?.id ?? "",
    barberId: selectedBarberId !== "TODOS" ? selectedBarberId : (barbers[0]?.id ?? ""),
    customerName: "",
    customerPhone: "",
    date: selectedDate,
    time: "09:00",
    recurrence: "NONE",
    repeatUntil: selectedDate,
  } satisfies CreateBookingDraft;
}

export function AdminAgenda({ bookings, barbers, services }: AdminAgendaProps) {
  const [isPendingStatus, startStatusTransition] = useTransition();
  const [isPendingCreate, startCreateTransition] = useTransition();
  const { pushToast } = useToast();
  const [allBookings, setAllBookings] = useState(bookings);
  const [lastAlert, setLastAlert] = useState<string | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [dateFilter, setDateFilter] = useState(() => formatDateInput(new Date()));
  const [barberFilter, setBarberFilter] = useState("TODOS");
  const [statusFilter, setStatusFilter] = useState("TODOS");
  const [createDraft, setCreateDraft] = useState<CreateBookingDraft>(() =>
    getDefaultDraft(barbers, services, formatDateInput(new Date()), "TODOS"),
  );
  const knownBookingIdsRef = useRef(new Set(bookings.map((booking) => booking.id)));
  const hasLoadedPollRef = useRef(false);

  const minCalendarDate = useMemo(() => {
    if (allBookings.length === 0) {
      return formatDateInput(new Date());
    }

    let minDate = allBookings[0]?.dateTimeStart.slice(0, 10) ?? formatDateInput(new Date());
    for (const booking of allBookings) {
      const day = booking.dateTimeStart.slice(0, 10);
      if (day < minDate) {
        minDate = day;
      }
    }
    return minDate;
  }, [allBookings]);

  const filtered = useMemo(() => {
    return allBookings.filter((booking) => {
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
  }, [allBookings, dateFilter, barberFilter, statusFilter]);

  const syncBookings = useCallback(async (options?: { notifyNew?: boolean; showErrorToast?: boolean }) => {
    try {
      const response = await fetch("/api/admin/bookings", {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error("Falha ao atualizar agenda");
      }

      const data = (await response.json()) as BookingWithRelations[];
      const nextIds = new Set(data.map((booking) => booking.id));

      if (options?.notifyNew) {
        const newBookings = data.filter((booking) => !knownBookingIdsRef.current.has(booking.id));

        if (hasLoadedPollRef.current && newBookings.length > 0) {
          const latestBooking = [...newBookings].sort((a, b) => {
            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
          })[0];

          if (latestBooking) {
            const alertMessage =
              newBookings.length === 1
                ? `Novo agendamento: ${latestBooking.customerName} as ${formatTimeLabel(latestBooking.dateTimeStart)}.`
                : `${newBookings.length} novos agendamentos recebidos.`;

            setLastAlert(alertMessage);
            pushToast(alertMessage, "success");

            const AudioContextClass = window.AudioContext || (window as typeof window & {
              webkitAudioContext?: typeof AudioContext;
            }).webkitAudioContext;

            if (AudioContextClass) {
              try {
                const audioContext = new AudioContextClass();
                const oscillator = audioContext.createOscillator();
                const gainNode = audioContext.createGain();

                oscillator.type = "triangle";
                oscillator.frequency.setValueAtTime(880, audioContext.currentTime);
                oscillator.frequency.exponentialRampToValueAtTime(660, audioContext.currentTime + 0.18);
                gainNode.gain.setValueAtTime(0.0001, audioContext.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.09, audioContext.currentTime + 0.02);
                gainNode.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.35);

                oscillator.connect(gainNode);
                gainNode.connect(audioContext.destination);
                oscillator.start();
                oscillator.stop(audioContext.currentTime + 0.36);
                window.setTimeout(() => {
                  void audioContext.close().catch(() => undefined);
                }, 450);
              } catch {
                // Se o navegador bloquear o audio, mantemos o aviso visual e o toast.
              }
            }
          }
        }

        hasLoadedPollRef.current = true;
      }

      setAllBookings(data);
      knownBookingIdsRef.current = nextIds;
    } catch (error) {
      if (options?.showErrorToast !== false) {
        pushToast(error instanceof Error ? error.message : "Erro ao atualizar agenda", "error");
      }
    }
  }, [pushToast]);

  useEffect(() => {
    setAllBookings(bookings);
    knownBookingIdsRef.current = new Set(bookings.map((booking) => booking.id));
  }, [bookings]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void syncBookings({ notifyNew: true, showErrorToast: false });
    }, 15000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [syncBookings]);

  function openCreateModal() {
    setCreateDraft(getDefaultDraft(barbers, services, dateFilter, barberFilter));
    setIsCreateModalOpen(true);
  }

  function closeCreateModal() {
    setIsCreateModalOpen(false);
  }

  function changeStatus(bookingId: string, status: "PENDENTE" | "CONFIRMADO" | "CANCELADO") {
    startStatusTransition(async () => {
      try {
        await updateBookingStatusAction({ bookingId, status });
        pushToast("Status atualizado", "success");
        await syncBookings({ showErrorToast: true });
      } catch (error) {
        pushToast(error instanceof Error ? error.message : "Erro ao atualizar", "error");
      }
    });
  }

  function handleCreateBooking() {
    if (!createDraft.date || !createDraft.time) {
      pushToast("Selecione data e horario", "error");
      return;
    }

    const start = new Date(`${createDraft.date}T${createDraft.time}:00`);
    if (Number.isNaN(start.getTime())) {
      pushToast("Data/hora invalida", "error");
      return;
    }

    startCreateTransition(async () => {
      const result = await createAdminBookingsAction({
        serviceId: createDraft.serviceId,
        barberId: createDraft.barberId,
        customerName: createDraft.customerName,
        customerPhone: createDraft.customerPhone,
        start: start.toISOString(),
        recurrence: createDraft.recurrence,
        repeatUntil: createDraft.recurrence === "NONE" ? undefined : createDraft.repeatUntil,
      });

      pushToast(result.message, result.success ? "success" : "error");
      if (!result.success) {
        return;
      }

      closeCreateModal();
      await syncBookings({ showErrorToast: true });
    });
  }

  const isBusy = isPendingStatus || isPendingCreate;

  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-zinc-100 sm:text-2xl">Agenda</h2>
            <p className="mt-1 text-sm text-zinc-400">Acompanhe, atualize e crie agendamentos manualmente.</p>
          </div>
          <button
            type="button"
            onClick={openCreateModal}
            className="rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-cyan-300"
          >
            Novo agendamento
          </button>
        </div>
      </div>

      {lastAlert ? (
        <div className="rounded-2xl border border-cyan-500/40 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-50">
          <div className="flex items-center justify-between gap-3">
            <p>{lastAlert}</p>
            <button
              type="button"
              onClick={() => setLastAlert(null)}
              className="rounded-md border border-cyan-400/40 px-2 py-1 text-xs text-cyan-100 transition hover:bg-cyan-500/10"
            >
              Fechar
            </button>
          </div>
        </div>
      ) : null}

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
              <p className="text-xs text-zinc-500">Atualizacao automatica a cada 15 segundos.</p>
            </div>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-zinc-800">
        <table className="w-full min-w-190 text-left text-sm">
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
                      disabled={isBusy}
                      onClick={() => changeStatus(booking.id, "CONFIRMADO")}
                      className="rounded border border-emerald-400/50 px-2 py-1 text-xs text-emerald-200"
                    >
                      Confirmar
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
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

      {isCreateModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/75 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-zinc-800 bg-zinc-900 p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-xl font-semibold text-zinc-100">Novo agendamento</h3>
                <p className="mt-1 text-sm text-zinc-400">
                  Crie um horario manual e, se quiser, repita como na agenda do Google.
                </p>
              </div>
              <button
                type="button"
                onClick={closeCreateModal}
                className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 transition hover:bg-zinc-800"
              >
                Fechar
              </button>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="space-y-2">
                <span className="text-sm text-zinc-300">Cliente</span>
                <input
                  type="text"
                  value={createDraft.customerName}
                  onChange={(event) => setCreateDraft((prev) => ({ ...prev, customerName: event.target.value }))}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
                />
              </label>

              <label className="space-y-2">
                <span className="text-sm text-zinc-300">Telefone</span>
                <input
                  type="text"
                  value={createDraft.customerPhone}
                  onChange={(event) =>
                    setCreateDraft((prev) => ({ ...prev, customerPhone: formatPhone(event.target.value) }))
                  }
                  placeholder="(11) 99999-9999"
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
                />
              </label>

              <label className="space-y-2">
                <span className="text-sm text-zinc-300">Servico</span>
                <select
                  value={createDraft.serviceId}
                  onChange={(event) => setCreateDraft((prev) => ({ ...prev, serviceId: event.target.value }))}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
                >
                  <option value="">Selecione</option>
                  {services.map((service) => (
                    <option key={service.id} value={service.id}>
                      {service.name} - {formatBRLFromCents(service.priceCents)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-2">
                <span className="text-sm text-zinc-300">Barbeiro</span>
                <select
                  value={createDraft.barberId}
                  onChange={(event) => setCreateDraft((prev) => ({ ...prev, barberId: event.target.value }))}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
                >
                  <option value="">Selecione</option>
                  {barbers.map((barber) => (
                    <option key={barber.id} value={barber.id}>
                      {barber.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-2">
                <span className="text-sm text-zinc-300">Data</span>
                <input
                  type="date"
                  value={createDraft.date}
                  min={formatDateInput(new Date())}
                  onChange={(event) =>
                    setCreateDraft((prev) => ({
                      ...prev,
                      date: event.target.value,
                      repeatUntil: prev.recurrence === "NONE" ? event.target.value : prev.repeatUntil,
                    }))
                  }
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
                />
              </label>

              <label className="space-y-2">
                <span className="text-sm text-zinc-300">Horario</span>
                <input
                  type="time"
                  value={createDraft.time}
                  onChange={(event) => setCreateDraft((prev) => ({ ...prev, time: event.target.value }))}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
                />
              </label>
            </div>

            <div className="mt-5 rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
              <h4 className="text-sm font-semibold text-zinc-100">Repeticao</h4>
              <div className="mt-3 grid gap-4 sm:grid-cols-[1fr_1fr]">
                <label className="space-y-2">
                  <span className="text-sm text-zinc-300">Frequencia</span>
                  <select
                    value={createDraft.recurrence}
                    onChange={(event) =>
                      setCreateDraft((prev) => ({
                        ...prev,
                        recurrence: event.target.value as RecurrenceOption,
                        repeatUntil:
                          event.target.value === "NONE" ? prev.date : (prev.repeatUntil || prev.date),
                      }))
                    }
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
                  >
                    <option value="NONE">Nao repetir</option>
                    <option value="DAILY">Todos os dias</option>
                    <option value="WEEKLY">Toda semana</option>
                    <option value="MONTHLY">Todo mes</option>
                  </select>
                </label>

                <label className="space-y-2">
                  <span className="text-sm text-zinc-300">Repetir ate</span>
                  <input
                    type="date"
                    value={createDraft.repeatUntil}
                    min={createDraft.date}
                    disabled={createDraft.recurrence === "NONE"}
                    onChange={(event) => setCreateDraft((prev) => ({ ...prev, repeatUntil: event.target.value }))}
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100 disabled:opacity-50"
                  />
                </label>
              </div>
              <p className="mt-3 text-xs text-zinc-500">
                Series recorrentes sao criadas ate a data final informada, com limite de 60 ocorrencias por operacao.
              </p>
            </div>

            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={closeCreateModal}
                disabled={isPendingCreate}
                className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleCreateBooking}
                disabled={isPendingCreate}
                className="rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-cyan-300 disabled:opacity-60"
              >
                {isPendingCreate ? "Criando..." : "Salvar agendamento"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
