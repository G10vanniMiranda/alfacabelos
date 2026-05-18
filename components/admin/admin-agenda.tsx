"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  createAdminBookingsAction,
  updateAdminBookingAction,
  updateBookingPaymentStatusAction,
  updateBookingStatusAction,
} from "@/lib/actions/booking-actions";
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

type EditBookingDraft = {
  bookingId: string;
  serviceId: string;
  barberId: string;
  customerName: string;
  customerPhone: string;
  date: string;
  time: string;
};

type ActionsMenuPosition = {
  top: number;
  left: number;
};

function formatTimeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateLabel(date: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date(`${date}T12:00:00`));
}

function formatDateTimeLabel(iso: string) {
  const date = new Date(iso);
  return {
    date: date.toLocaleDateString("pt-BR"),
    time: date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
  };
}

function getPaymentBadgeClasses(paymentStatus: "PENDENTE" | "CONFIRMADO") {
  return paymentStatus === "CONFIRMADO"
    ? "border-emerald-400/50 bg-emerald-400/15 text-emerald-200"
    : "border-amber-400/50 bg-amber-500/15 text-amber-100";
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
  const [editingBooking, setEditingBooking] = useState<EditBookingDraft | null>(null);
  const [openActionsBookingId, setOpenActionsBookingId] = useState<string | null>(null);
  const [dateFilter, setDateFilter] = useState(() => formatDateInput(new Date()));
  const [barberFilter, setBarberFilter] = useState("TODOS");
  const [statusFilter, setStatusFilter] = useState("TODOS");
  const [actionsMenuPlacement, setActionsMenuPlacement] = useState<"down" | "up">("down");
  const [actionsMenuPosition, setActionsMenuPosition] = useState<ActionsMenuPosition | null>(null);
  const [createDraft, setCreateDraft] = useState<CreateBookingDraft>(() =>
    getDefaultDraft(barbers, services, formatDateInput(new Date()), "TODOS"),
  );
  const knownBookingIdsRef = useRef(new Set(bookings.map((booking) => booking.id)));
  const hasLoadedPollRef = useRef(false);
  const actionsMenuRef = useRef<HTMLDivElement | null>(null);

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
    }).sort((a, b) => new Date(a.dateTimeStart).getTime() - new Date(b.dateTimeStart).getTime());
  }, [allBookings, dateFilter, barberFilter, statusFilter]);

  const dayBookings = useMemo(() => {
    return allBookings.filter((booking) => !dateFilter || booking.dateTimeStart.startsWith(dateFilter));
  }, [allBookings, dateFilter]);

  const dayStats = useMemo(() => {
    return {
      total: dayBookings.length,
      pending: dayBookings.filter((booking) => booking.status === "PENDENTE").length,
      confirmed: dayBookings.filter((booking) => booking.status === "CONFIRMADO").length,
      canceled: dayBookings.filter((booking) => booking.status === "CANCELADO").length,
      paid: dayBookings.filter((booking) => booking.paymentStatus === "CONFIRMADO").length,
    };
  }, [dayBookings]);

  const selectedDayLabel = useMemo(() => formatDateLabel(dateFilter), [dateFilter]);
  const openActionsBooking = useMemo(() => {
    return allBookings.find((booking) => booking.id === openActionsBookingId);
  }, [allBookings, openActionsBookingId]);

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
                // Mantem apenas alerta visual e toast.
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

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if ((event.target as HTMLElement).closest("[data-actions-trigger='true']")) {
        return;
      }

      if (!actionsMenuRef.current?.contains(event.target as Node)) {
        setOpenActionsBookingId(null);
        setActionsMenuPosition(null);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenActionsBookingId(null);
        setActionsMenuPosition(null);
      }
    }

    function closeFloatingMenu() {
      setOpenActionsBookingId(null);
      setActionsMenuPosition(null);
    }

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    window.addEventListener("resize", closeFloatingMenu);
    window.addEventListener("scroll", closeFloatingMenu, true);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
      window.removeEventListener("resize", closeFloatingMenu);
      window.removeEventListener("scroll", closeFloatingMenu, true);
    };
  }, []);

  function openCreateModal() {
    setCreateDraft(getDefaultDraft(barbers, services, dateFilter, barberFilter));
    setIsCreateModalOpen(true);
  }

  function closeCreateModal() {
    setIsCreateModalOpen(false);
  }

  function openEditModal(booking: BookingWithRelations) {
    const date = booking.dateTimeStart.slice(0, 10);
    const local = new Date(booking.dateTimeStart);
    const time = local.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

    setEditingBooking({
      bookingId: booking.id,
      serviceId: booking.serviceId,
      barberId: booking.barberId,
      customerName: booking.customerName,
      customerPhone: booking.customerPhone,
      date,
      time,
    });
    setOpenActionsBookingId(null);
    setActionsMenuPosition(null);
  }

  function closeEditModal() {
    setEditingBooking(null);
  }

  function toggleActionsMenu(bookingId: string, button: HTMLButtonElement) {
    if (openActionsBookingId === bookingId) {
      setOpenActionsBookingId(null);
      setActionsMenuPosition(null);
      return;
    }

    const buttonRect = button.getBoundingClientRect();
    const viewportMargin = 12;
    const estimatedMenuWidth = 252;
    const estimatedMenuHeight = 210;
    const spaceBelow = window.innerHeight - buttonRect.bottom;
    const spaceAbove = buttonRect.top;
    const shouldOpenUp = spaceBelow < estimatedMenuHeight + viewportMargin && spaceAbove > spaceBelow;
    const left = Math.min(
      Math.max(buttonRect.right - estimatedMenuWidth, viewportMargin),
      window.innerWidth - estimatedMenuWidth - viewportMargin,
    );
    const preferredTop = shouldOpenUp
      ? buttonRect.top - estimatedMenuHeight - 8
      : buttonRect.bottom + 8;
    const top = Math.min(
      Math.max(preferredTop, viewportMargin),
      window.innerHeight - estimatedMenuHeight - viewportMargin,
    );

    setActionsMenuPlacement(shouldOpenUp ? "up" : "down");
    setActionsMenuPosition({ top, left });
    setOpenActionsBookingId(bookingId);
  }

  function changeStatus(bookingId: string, status: "PENDENTE" | "CONFIRMADO" | "CANCELADO") {
    startStatusTransition(async () => {
      try {
        await updateBookingStatusAction({ bookingId, status });
        pushToast("Status atualizado", "success");
        setOpenActionsBookingId(null);
        setActionsMenuPosition(null);
        await syncBookings({ showErrorToast: true });
      } catch (error) {
        pushToast(error instanceof Error ? error.message : "Erro ao atualizar", "error");
      }
    });
  }

  function changePaymentStatus(bookingId: string, paymentStatus: "PENDENTE" | "CONFIRMADO") {
    startStatusTransition(async () => {
      try {
        await updateBookingPaymentStatusAction({ bookingId, paymentStatus });
        pushToast("Pagamento atualizado", "success");
        setOpenActionsBookingId(null);
        setActionsMenuPosition(null);
        await syncBookings({ showErrorToast: true });
      } catch (error) {
        pushToast(error instanceof Error ? error.message : "Erro ao atualizar pagamento", "error");
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

  function handleEditBooking() {
    if (!editingBooking?.date || !editingBooking.time) {
      pushToast("Selecione data e horario", "error");
      return;
    }

    const start = new Date(`${editingBooking.date}T${editingBooking.time}:00`);
    if (Number.isNaN(start.getTime())) {
      pushToast("Data/hora invalida", "error");
      return;
    }

    startCreateTransition(async () => {
      const result = await updateAdminBookingAction({
        bookingId: editingBooking.bookingId,
        serviceId: editingBooking.serviceId,
        barberId: editingBooking.barberId,
        customerName: editingBooking.customerName,
        customerPhone: editingBooking.customerPhone,
        start: start.toISOString(),
      });

      pushToast(result.message, result.success ? "success" : "error");
      if (!result.success) {
        return;
      }

      closeEditModal();
      await syncBookings({ showErrorToast: true });
    });
  }

  const isBusy = isPendingStatus || isPendingCreate;

  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 px-4 py-5 sm:px-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-cyan-200">Operacao</p>
            <h2 className="mt-1 text-xl font-semibold text-zinc-100 sm:text-2xl">Agenda</h2>
            <p className="mt-1 text-sm capitalize text-zinc-400">{selectedDayLabel}</p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={() => void syncBookings({ showErrorToast: true })}
              disabled={isBusy}
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-4 py-2 text-sm font-semibold text-zinc-100 transition hover:border-cyan-400/70 disabled:opacity-60"
            >
              Atualizar
            </button>
            <button
              type="button"
              onClick={openCreateModal}
              disabled={barbers.length === 0 || services.length === 0}
              className="rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-cyan-300 disabled:opacity-60"
            >
              Novo agendamento
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-zinc-500">No dia</p>
            <p className="mt-1 text-2xl font-semibold text-zinc-100">{dayStats.total}</p>
          </div>
          <div className="rounded-xl border border-amber-400/20 bg-amber-500/10 px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-amber-100/70">Pendentes</p>
            <p className="mt-1 text-2xl font-semibold text-amber-100">{dayStats.pending}</p>
          </div>
          <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-emerald-100/70">Confirmados</p>
            <p className="mt-1 text-2xl font-semibold text-emerald-100">{dayStats.confirmed}</p>
          </div>
          <div className="rounded-xl border border-red-400/20 bg-red-500/10 px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-red-100/70">Cancelados</p>
            <p className="mt-1 text-2xl font-semibold text-red-100">{dayStats.canceled}</p>
          </div>
          <div className="rounded-xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-cyan-100/70">Pagos</p>
            <p className="mt-1 text-2xl font-semibold text-cyan-50">{dayStats.paid}</p>
          </div>
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

      <div className="grid gap-4 rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div>
          <p className="text-sm font-semibold text-zinc-100">Calendario</p>
          <p className="mt-1 text-sm text-zinc-500">Escolha o dia para acompanhar a agenda.</p>
          <DateCalendar
            minDate={minCalendarDate}
            maxMonthsForward={24}
            selectedDate={dateFilter}
            onSelect={setDateFilter}
          />
        </div>

        <div>
          <p className="text-sm font-semibold text-zinc-100">Filtros</p>
          <p className="mt-1 text-sm text-zinc-500">Refine a lista do dia selecionado.</p>
          <div className="mt-2 rounded-xl border border-zinc-800 bg-zinc-950/60 p-3 sm:p-4">
            <div className="space-y-3">
              <label className="space-y-1">
                <span className="text-xs font-medium text-zinc-500">Barbeiro</span>
                <select
                  value={barberFilter}
                  onChange={(event) => setBarberFilter(event.target.value)}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100 outline-none transition focus:border-cyan-400"
                >
                  <option value="TODOS">Todos os barbeiros</option>
                  {barbers.map((barber) => (
                    <option key={barber.id} value={barber.id}>
                      {barber.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium text-zinc-500">Status</span>
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100 outline-none transition focus:border-cyan-400"
                >
                  <option value="TODOS">Todos os status</option>
                  <option value="PENDENTE">Pendente</option>
                  <option value="CONFIRMADO">Confirmado</option>
                  <option value="CANCELADO">Cancelado</option>
                </select>
              </label>
              <button
                type="button"
                onClick={() => setDateFilter(formatDateInput(new Date()))}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 transition hover:border-cyan-400/60"
              >
                Ir para hoje
              </button>
              <button
                type="button"
                onClick={() => {
                  setBarberFilter("TODOS");
                  setStatusFilter("TODOS");
                }}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 transition hover:border-cyan-400/60"
              >
                Limpar filtros
              </button>
              <p className="text-xs text-zinc-500">Atualizacao automatica a cada 15 segundos.</p>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70">
        <div className="flex flex-col gap-2 border-b border-zinc-800 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-zinc-100">Agendamentos</h3>
            <p className="mt-1 text-sm text-zinc-500">
              {filtered.length} resultado{filtered.length === 1 ? "" : "s"} para os filtros atuais.
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="bg-zinc-950/80 text-zinc-300">
            <tr>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide">Cliente</th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide">Servico</th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide">Barbeiro</th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide">Horario</th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide">Status</th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide">Pagamento</th>
              <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide">Acoes</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((booking) => {
              const dateTime = formatDateTimeLabel(booking.dateTimeStart);

              return (
              <tr key={booking.id} className="border-t border-zinc-800 bg-zinc-950/35 transition hover:bg-zinc-950/70">
                <td className="px-4 py-3 text-zinc-200">
                  <p className="font-semibold">{booking.customerName}</p>
                  <p className="mt-0.5 text-xs text-zinc-500">{booking.customerPhone}</p>
                </td>
                <td className="px-4 py-3 text-zinc-200">
                  <p>{booking.service.name}</p>
                  <p className="mt-0.5 text-xs text-zinc-500">{booking.service.durationMinutes} min</p>
                </td>
                <td className="px-4 py-3 text-zinc-200">{booking.barber.name}</td>
                <td className="whitespace-nowrap px-4 py-3 text-zinc-300">
                  <p className="font-semibold text-zinc-100">{dateTime.time}</p>
                  <p className="mt-0.5 text-xs text-zinc-500">{dateTime.date}</p>
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={booking.status} />
                </td>
                <td className="px-4 py-3">
                  <span className={`rounded-full border px-2 py-1 text-xs font-semibold ${getPaymentBadgeClasses(booking.paymentStatus)}`}>
                    {booking.paymentStatus}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="relative">
                    <button
                      type="button"
                      data-actions-trigger="true"
                      disabled={isBusy}
                      onMouseDown={(event) => event.stopPropagation()}
                      onClick={(event) => toggleActionsMenu(booking.id, event.currentTarget)}
                      aria-haspopup="menu"
                      aria-expanded={openActionsBookingId === booking.id}
                      aria-label="Abrir acoes do agendamento"
                      className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-semibold text-zinc-200 transition hover:border-cyan-400/60 hover:text-cyan-300 disabled:opacity-40"
                    >
                      ...
                    </button>

                  </div>
                </td>
              </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-5 text-center text-zinc-500">
                  Nenhum agendamento encontrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>

      {openActionsBooking && actionsMenuPosition ? (
        <div
          ref={actionsMenuRef}
          role="menu"
          style={{ top: actionsMenuPosition.top, left: actionsMenuPosition.left }}
          className={`fixed z-[100] w-[252px] rounded-xl border border-zinc-800 bg-zinc-950 p-2 shadow-2xl shadow-black/40 ${
            actionsMenuPlacement === "up" ? "origin-bottom-right" : "origin-top-right"
          }`}
        >
          <button
            type="button"
            role="menuitem"
            disabled={isBusy || openActionsBooking.status === "CONFIRMADO"}
            onClick={() => changeStatus(openActionsBooking.id, "CONFIRMADO")}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-zinc-200 transition hover:bg-zinc-900 disabled:opacity-40"
          >
            <span className="w-6 text-xs font-semibold text-emerald-200">OK</span>
            <span>Confirmar agendamento</span>
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={
              isBusy || openActionsBooking.status === "CANCELADO" || openActionsBooking.paymentStatus === "CONFIRMADO"
            }
            onClick={() => changePaymentStatus(openActionsBooking.id, "CONFIRMADO")}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-zinc-200 transition hover:bg-zinc-900 disabled:opacity-40"
          >
            <span className="w-6 text-xs font-semibold text-cyan-200">R$</span>
            <span>Confirmar pagamento</span>
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={isBusy}
            onClick={() => openEditModal(openActionsBooking)}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-zinc-200 transition hover:bg-zinc-900 disabled:opacity-40"
          >
            <span className="w-6 text-xs font-semibold text-zinc-300">ED</span>
            <span>Editar agendamento</span>
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={isBusy || openActionsBooking.status === "CANCELADO"}
            onClick={() => changeStatus(openActionsBooking.id, "CANCELADO")}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-red-200 transition hover:bg-red-500/10 disabled:opacity-40"
          >
            <span className="w-6 text-xs font-semibold text-red-200">X</span>
            <span>Cancelar agendamento</span>
          </button>
        </div>
      ) : null}

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

      {editingBooking ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/75 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-zinc-800 bg-zinc-900 p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-xl font-semibold text-zinc-100">Editar agendamento</h3>
                <p className="mt-1 text-sm text-zinc-400">Corrija cliente, servico, barbeiro, data ou horario.</p>
              </div>
              <button
                type="button"
                onClick={closeEditModal}
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
                  value={editingBooking.customerName}
                  onChange={(event) =>
                    setEditingBooking((prev) => (prev ? { ...prev, customerName: event.target.value } : prev))
                  }
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
                />
              </label>

              <label className="space-y-2">
                <span className="text-sm text-zinc-300">Telefone</span>
                <input
                  type="text"
                  value={editingBooking.customerPhone}
                  onChange={(event) =>
                    setEditingBooking((prev) =>
                      prev ? { ...prev, customerPhone: formatPhone(event.target.value) } : prev,
                    )
                  }
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
                />
              </label>

              <label className="space-y-2">
                <span className="text-sm text-zinc-300">Servico</span>
                <select
                  value={editingBooking.serviceId}
                  onChange={(event) =>
                    setEditingBooking((prev) => (prev ? { ...prev, serviceId: event.target.value } : prev))
                  }
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
                >
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
                  value={editingBooking.barberId}
                  onChange={(event) =>
                    setEditingBooking((prev) => (prev ? { ...prev, barberId: event.target.value } : prev))
                  }
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
                >
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
                  value={editingBooking.date}
                  onChange={(event) =>
                    setEditingBooking((prev) => (prev ? { ...prev, date: event.target.value } : prev))
                  }
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
                />
              </label>

              <label className="space-y-2">
                <span className="text-sm text-zinc-300">Horario</span>
                <input
                  type="time"
                  value={editingBooking.time}
                  onChange={(event) =>
                    setEditingBooking((prev) => (prev ? { ...prev, time: event.target.value } : prev))
                  }
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
                />
              </label>
            </div>

            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={closeEditModal}
                disabled={isPendingCreate}
                className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleEditBooking}
                disabled={isPendingCreate}
                className="rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-cyan-300 disabled:opacity-60"
              >
                {isPendingCreate ? "Salvando..." : "Salvar alteracoes"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
