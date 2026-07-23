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
import { BUSINESS_CONFIG } from "@/lib/config";
import {
  formatBRLFromCents,
  getTodayInTimeZone,
  formatPhone,
  getLocalDateInput,
  getTimeLabelInTimeZone,
  zonedDateTimeToUtcIso,
} from "@/lib/utils";
import { buildBookingWhatsAppUrl } from "@/lib/whatsapp";
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
  observations: string;
  date: string;
  time: string;
  recurrence: RecurrenceOption;
  repeatUntil: string;
  idempotencyKey: string;
};

type EditBookingDraft = {
  bookingId: string;
  seriesId?: string;
  serviceId: string;
  barberId: string;
  customerName: string;
  customerPhone: string;
  date: string;
  time: string;
  scope: "SINGLE" | "FUTURE" | "ALL";
};

type RecurrenceDraft = {
  date: string;
  time: string;
  recurrence: RecurrenceOption;
  repeatUntil: string;
};

type ActionsMenuPosition = {
  top: number;
  left: number;
};

function formatTimeLabel(iso: string) {
  return getTimeLabelInTimeZone(iso, BUSINESS_CONFIG.timezone);
}

function formatDateLabel(date: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date(`${date}T12:00:00`));
}

function getBookingDateKey(iso: string) {
  return getLocalDateInput(iso, BUSINESS_CONFIG.timezone);
}

function formatDateTimeLabel(iso: string) {
  const dateKey = getLocalDateInput(iso, BUSINESS_CONFIG.timezone);
  return {
    date: dateKey.split("-").reverse().join("/"),
    time: getTimeLabelInTimeZone(iso, BUSINESS_CONFIG.timezone),
  };
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function parseDateParts(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return { year, month, day };
}

function toDateInput(year: number, month: number, day: number) {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

function addDateByRecurrence(startDate: string, recurrence: RecurrenceOption, step: number) {
  const { year, month, day } = parseDateParts(startDate);

  if (recurrence === "DAILY") {
    const date = new Date(year, month - 1, day + step);
    return toDateInput(date.getFullYear(), date.getMonth() + 1, date.getDate());
  }

  if (recurrence === "WEEKLY") {
    const date = new Date(year, month - 1, day + step * 7);
    return toDateInput(date.getFullYear(), date.getMonth() + 1, date.getDate());
  }

  if (recurrence === "MONTHLY") {
    const monthIndex = month - 1 + step;
    const targetYear = year + Math.floor(monthIndex / 12);
    const targetMonth = ((monthIndex % 12) + 12) % 12 + 1;
    const targetDay = Math.min(day, daysInMonth(targetYear, targetMonth));
    return toDateInput(targetYear, targetMonth, targetDay);
  }

  return startDate;
}

function addDaysToDateInput(date: string, amount: number) {
  const { year, month, day } = parseDateParts(date);
  const next = new Date(year, month - 1, day + amount);
  return toDateInput(next.getFullYear(), next.getMonth() + 1, next.getDate());
}

function addMonthsToDateInput(date: string, amount: number) {
  const { year, month, day } = parseDateParts(date);
  const monthIndex = month - 1 + amount;
  const targetYear = year + Math.floor(monthIndex / 12);
  const targetMonth = ((monthIndex % 12) + 12) % 12 + 1;
  return toDateInput(targetYear, targetMonth, Math.min(day, daysInMonth(targetYear, targetMonth)));
}

function getDefaultRepeatUntil(date: string, recurrence: RecurrenceOption) {
  if (recurrence === "DAILY") {
    return addDaysToDateInput(date, 7);
  }
  if (recurrence === "WEEKLY") {
    return addMonthsToDateInput(date, 1);
  }
  if (recurrence === "MONTHLY") {
    return addMonthsToDateInput(date, 6);
  }
  return date;
}

function buildOccurrenceStarts(draft: RecurrenceDraft) {
  if (!draft.date || !draft.time) {
    return [];
  }

  if (draft.recurrence === "NONE") {
    return [zonedDateTimeToUtcIso(draft.date, `${draft.time}:00`, BUSINESS_CONFIG.timezone)];
  }

  if (!draft.repeatUntil || draft.repeatUntil < draft.date) {
    return [];
  }

  const starts: string[] = [];
  for (let step = 0; step < 60; step += 1) {
    const date = addDateByRecurrence(draft.date, draft.recurrence, step);
    if (date > draft.repeatUntil) {
      break;
    }

    starts.push(zonedDateTimeToUtcIso(date, `${draft.time}:00`, BUSINESS_CONFIG.timezone));
  }

  return starts;
}

function getRecurrenceLabel(recurrence: RecurrenceOption, date: string) {
  if (recurrence === "DAILY") {
    return "Diariamente";
  }
  if (recurrence === "WEEKLY") {
    return `Semanalmente em ${new Intl.DateTimeFormat("pt-BR", { weekday: "long" }).format(new Date(`${date}T12:00:00`))}`;
  }
  if (recurrence === "MONTHLY") {
    return `Mensalmente no dia ${parseDateParts(date).day}`;
  }
  return "Não repetir";
}

function getPaymentBadgeClasses(paymentStatus: "PENDENTE" | "CONFIRMADO") {
  return paymentStatus === "CONFIRMADO"
    ? "border-success/50 bg-success/15 text-success-soft"
    : "border-warning/50 bg-warning/15 text-warning-soft";
}

function getDefaultDraft(barbers: Barber[], services: Service[], selectedDate: string, selectedBarberId: string) {
  return {
    serviceId: services[0]?.id ?? "",
    barberId: selectedBarberId !== "TODOS" ? selectedBarberId : (barbers[0]?.id ?? ""),
    customerName: "",
    customerPhone: "",
    observations: "",
    date: selectedDate,
    time: "09:00",
    recurrence: "NONE",
    repeatUntil: selectedDate,
    idempotencyKey: "",
  } satisfies CreateBookingDraft;
}

export function AdminAgenda({ bookings, barbers, services }: AdminAgendaProps) {
  const [businessToday] = useState(() => getTodayInTimeZone(BUSINESS_CONFIG.timezone));
  const [isPendingStatus, startStatusTransition] = useTransition();
  const [isPendingCreate, startCreateTransition] = useTransition();
  const { pushToast } = useToast();
  const [allBookings, setAllBookings] = useState(bookings);
  const [lastAlert, setLastAlert] = useState<string | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingBooking, setEditingBooking] = useState<EditBookingDraft | null>(null);
  const [openActionsBookingId, setOpenActionsBookingId] = useState<string | null>(null);
  const [notificationSoundEnabled, setNotificationSoundEnabled] = useState(false);
  const [dateFilter, setDateFilter] = useState(() => businessToday);
  const [barberFilter, setBarberFilter] = useState("TODOS");
  const [statusFilter, setStatusFilter] = useState("TODOS");
  const [actionsMenuPlacement, setActionsMenuPlacement] = useState<"down" | "up">("down");
  const [actionsMenuPosition, setActionsMenuPosition] = useState<ActionsMenuPosition | null>(null);
  const [createDraft, setCreateDraft] = useState<CreateBookingDraft>(() =>
    getDefaultDraft(barbers, services, businessToday, "TODOS"),
  );
  const knownBookingIdsRef = useRef(new Set(bookings.map((booking) => booking.id)));
  const hasLoadedPollRef = useRef(false);
  const actionsMenuRef = useRef<HTMLDivElement | null>(null);
  const notificationAudioRef = useRef<AudioContext | null>(null);

  const minCalendarDate = useMemo(() => {
    if (allBookings.length === 0) {
      return businessToday;
    }

    let minDate = allBookings[0] ? getBookingDateKey(allBookings[0].dateTimeStart) : businessToday;
    for (const booking of allBookings) {
      const day = getBookingDateKey(booking.dateTimeStart);
      if (day < minDate) {
        minDate = day;
      }
    }
    return minDate;
  }, [allBookings, businessToday]);

  const filtered = useMemo(() => {
    return allBookings.filter((booking) => {
      if (dateFilter && getBookingDateKey(booking.dateTimeStart) !== dateFilter) {
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
    return allBookings.filter((booking) => !dateFilter || getBookingDateKey(booking.dateTimeStart) === dateFilter);
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
  const createOccurrenceStarts = useMemo(() => buildOccurrenceStarts(createDraft), [createDraft]);
  const createOccurrencePreview = useMemo(() => {
    return createOccurrenceStarts.slice(0, 3).map((start) => formatDateTimeLabel(start));
  }, [createOccurrenceStarts]);
  const recurrenceHasLimitError = createDraft.recurrence !== "NONE" && createOccurrenceStarts.length >= 60;

  const getNotificationAudioContext = useCallback(() => {
    const AudioContextClass = window.AudioContext || (window as typeof window & {
      webkitAudioContext?: typeof AudioContext;
    }).webkitAudioContext;

    if (!AudioContextClass) {
      return null;
    }

    if (!notificationAudioRef.current) {
      notificationAudioRef.current = new AudioContextClass();
    }

    return notificationAudioRef.current;
  }, []);

  const playNewBookingSound = useCallback(() => {
    const audioContext = getNotificationAudioContext();
    if (!audioContext || audioContext.state === "suspended") {
      return;
    }

    const now = audioContext.currentTime;
    const notes = [
      { frequency: 880, start: 0, duration: 0.13 },
      { frequency: 1174.66, start: 0.15, duration: 0.16 },
      { frequency: 1567.98, start: 0.34, duration: 0.24 },
    ];

    for (const note of notes) {
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      const start = now + note.start;
      const end = start + note.duration;

      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(note.frequency, start);
      gainNode.gain.setValueAtTime(0.0001, start);
      gainNode.gain.exponentialRampToValueAtTime(0.16, start + 0.02);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, end);

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      oscillator.start(start);
      oscillator.stop(end + 0.02);
    }
  }, [getNotificationAudioContext]);

  async function enableNotificationSound() {
    const audioContext = getNotificationAudioContext();
    if (!audioContext) {
      pushToast("Som indisponível neste navegador", "error");
      return;
    }

    try {
      await audioContext.resume();
      setNotificationSoundEnabled(true);
      playNewBookingSound();
      pushToast("Som de novos agendamentos ativado", "success");
    } catch {
      pushToast("Não foi possível ativar o som", "error");
    }
  }

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
                ? `Novo agendamento: ${latestBooking.customerName} às ${formatTimeLabel(latestBooking.dateTimeStart)}.`
                : `${newBookings.length} novos agendamentos recebidos.`;

            setLastAlert(alertMessage);
            pushToast(alertMessage, "success");

            playNewBookingSound();
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
  }, [playNewBookingSound, pushToast]);

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
    return () => {
      void notificationAudioRef.current?.close().catch(() => undefined);
    };
  }, []);

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
    const date = getBookingDateKey(booking.dateTimeStart);
    const time = getTimeLabelInTimeZone(booking.dateTimeStart, BUSINESS_CONFIG.timezone);

    setEditingBooking({
      bookingId: booking.id,
      seriesId: booking.seriesId,
      serviceId: booking.serviceId,
      barberId: booking.barberId,
      customerName: booking.customerName,
      customerPhone: booking.customerPhone,
      date,
      time,
      scope: "SINGLE",
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

  function changeStatus(bookingId: string, status: "PENDENTE" | "CONFIRMADO" | "CANCELADO" | "CONCLUIDO" | "AUSENTE", scope: "SINGLE" | "FUTURE" | "ALL" = "SINGLE") {
    startStatusTransition(async () => {
      try {
        await updateBookingStatusAction({ bookingId, status, scope });
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
      pushToast("Selecione data e horário", "error");
      return;
    }

    const starts = buildOccurrenceStarts(createDraft);
    if (starts.length === 0) {
      pushToast("Data/hora inválida", "error");
      return;
    }

    if (createDraft.recurrence !== "NONE" && createDraft.repeatUntil < createDraft.date) {
      pushToast("A data final da repetição precisa ser igual ou posterior ao início", "error");
      return;
    }

    if (createDraft.recurrence !== "NONE" && starts.length >= 60) {
      pushToast("Reduza o período da repetição para menos de 60 ocorrências", "error");
      return;
    }

    const idempotencyKey = createDraft.recurrence === "NONE"
      ? undefined
      : (createDraft.idempotencyKey || crypto.randomUUID());
    if (idempotencyKey && !createDraft.idempotencyKey) {
      setCreateDraft((prev) => ({ ...prev, idempotencyKey }));
    }

    startCreateTransition(async () => {
      const result = await createAdminBookingsAction({
        serviceId: createDraft.serviceId,
        barberId: createDraft.barberId,
        customerName: createDraft.customerName,
        customerPhone: createDraft.customerPhone,
        observations: createDraft.observations,
        start: starts[0],
        starts,
        recurrence: createDraft.recurrence,
        repeatUntil: createDraft.recurrence === "NONE" ? undefined : createDraft.repeatUntil,
        interval: 1,
        weekdays: createDraft.recurrence === "WEEKLY"
          ? [new Date(`${createDraft.date}T12:00:00Z`).getUTCDay()]
          : undefined,
        idempotencyKey,
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
      pushToast("Selecione data e horário", "error");
      return;
    }

    const start = zonedDateTimeToUtcIso(editingBooking.date, `${editingBooking.time}:00`, BUSINESS_CONFIG.timezone);

    startCreateTransition(async () => {
      const result = await updateAdminBookingAction({
        bookingId: editingBooking.bookingId,
        serviceId: editingBooking.serviceId,
        barberId: editingBooking.barberId,
        customerName: editingBooking.customerName,
        customerPhone: editingBooking.customerPhone,
        start,
        scope: editingBooking.scope,
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
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-highlight">Operação</p>
            <h2 className="mt-1 text-xl font-semibold text-zinc-100 sm:text-2xl">Agenda</h2>
            <p className="mt-1 text-sm capitalize text-zinc-400">{selectedDayLabel}</p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={() => void enableNotificationSound()}
              className={`rounded-lg border px-4 py-2 text-sm font-semibold transition ${notificationSoundEnabled
                ? "border-success/40 bg-success/10 text-success-soft"
                : "border-zinc-700 bg-zinc-950 text-zinc-100 hover:border-brand/70"
                }`}
            >
              {notificationSoundEnabled ? "Som ativo" : "Ativar som"}
            </button>
            <button
              type="button"
              onClick={() => void syncBookings({ showErrorToast: true })}
              disabled={isBusy}
              className="button-secondary px-4 py-2 disabled:opacity-60"
            >
              Atualizar
            </button>
            <button
              type="button"
              onClick={openCreateModal}
              disabled={barbers.length === 0 || services.length === 0}
              className="button-primary px-4 py-2 disabled:opacity-60"
            >
              Novo agendamento
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-copy-muted">No dia</p>
            <p className="mt-1 text-2xl font-semibold text-zinc-100">{dayStats.total}</p>
          </div>
          <div className="rounded-xl border border-warning/20 bg-warning/10 px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-warning-soft/70">Pendentes</p>
            <p className="mt-1 text-2xl font-semibold text-warning-soft">{dayStats.pending}</p>
          </div>
          <div className="rounded-xl border border-success/20 bg-success/10 px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-success-soft/70">Confirmados</p>
            <p className="mt-1 text-2xl font-semibold text-success-soft">{dayStats.confirmed}</p>
          </div>
          <div className="rounded-xl border border-danger/20 bg-danger/10 px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-danger-soft/70">Cancelados</p>
            <p className="mt-1 text-2xl font-semibold text-danger-soft">{dayStats.canceled}</p>
          </div>
          <div className="rounded-xl border border-success/20 bg-success/10 px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-success-soft/70">Pagos</p>
            <p className="mt-1 text-2xl font-semibold text-success-soft">{dayStats.paid}</p>
          </div>
        </div>
      </div>

      {lastAlert ? (
        <div className="ui-alert ui-alert-success rounded-2xl text-sm">
          <div className="flex items-center justify-between gap-3">
            <p>{lastAlert}</p>
            <button
              type="button"
              onClick={() => setLastAlert(null)}
              className="button-ghost px-2 py-1 text-xs"
            >
              Fechar
            </button>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div>
          <p className="text-sm font-semibold text-zinc-100">Calendario</p>
          <p className="mt-1 text-sm text-copy-muted">Escolha o dia para acompanhar a agenda.</p>
          <DateCalendar
            minDate={minCalendarDate}
            maxMonthsForward={24}
            selectedDate={dateFilter}
            onSelect={setDateFilter}
            density="compact"
          />
        </div>

        <div>
          <p className="text-sm font-semibold text-zinc-100">Filtros</p>
          <p className="mt-1 text-sm text-copy-muted">Refine a lista do dia selecionado.</p>
          <div className="mt-2 rounded-xl border border-zinc-800 bg-zinc-950/60 p-3 sm:p-4">
            <div className="space-y-3">
              <label className="space-y-1">
                <span className="text-xs font-medium text-copy-muted">Barbeiro</span>
                <select
                  value={barberFilter}
                  onChange={(event) => setBarberFilter(event.target.value)}
                  className="ui-control w-full px-3 py-2"
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
                <span className="text-xs font-medium text-copy-muted">Status</span>
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                  className="ui-control w-full px-3 py-2"
                >
                  <option value="TODOS">Todos os status</option>
                  <option value="PENDENTE">Pendente</option>
                  <option value="CONFIRMADO">Confirmado</option>
                  <option value="CANCELADO">Cancelado</option>
                </select>
              </label>
              <button
                type="button"
                onClick={() => setDateFilter(businessToday)}
                className="ui-control w-full px-3 py-2 text-sm"
              >
                Ir para hoje
              </button>
              <button
                type="button"
                onClick={() => {
                  setBarberFilter("TODOS");
                  setStatusFilter("TODOS");
                }}
                className="ui-control w-full px-3 py-2 text-sm"
              >
                Limpar filtros
              </button>
              <p className="text-xs text-copy-muted">Atualização automatica a cada 15 segundos.</p>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70">
        <div className="flex flex-col gap-2 border-b border-zinc-800 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-zinc-100">Agendamentos</h3>
            <p className="mt-1 text-sm text-copy-muted">
              {filtered.length} resultado{filtered.length === 1 ? "" : "s"} para os filtros atuais.
            </p>
          </div>
        </div>

        <div className="ui-table-shell">
          <table className="w-full min-w-225 text-left text-sm">
            <thead className="bg-zinc-950/80 text-zinc-300">
              <tr>
                <th scope="col" className="px-4 py-3 text-xs font-semibold uppercase tracking-wide">Cliente</th>
                <th scope="col" className="px-4 py-3 text-xs font-semibold uppercase tracking-wide">Serviço</th>
                <th scope="col" className="px-4 py-3 text-xs font-semibold uppercase tracking-wide">Barbeiro</th>
                <th scope="col" className="px-4 py-3 text-xs font-semibold uppercase tracking-wide">Horário</th>
                <th scope="col" className="px-4 py-3 text-xs font-semibold uppercase tracking-wide">Status</th>
                <th scope="col" className="px-4 py-3 text-xs font-semibold uppercase tracking-wide">Pagamento</th>
                <th scope="col" className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((booking) => {
                const dateTime = formatDateTimeLabel(booking.dateTimeStart);

                return (
                  <tr key={booking.id} className="border-t border-zinc-800 bg-zinc-950/35 transition hover:bg-zinc-950/70">
                    <td className="px-4 py-3 text-zinc-200">
                      <p className="font-semibold">{booking.customerName}</p>
                      <p className="mt-0.5 text-xs text-copy-muted">{booking.customerPhone}</p>
                    </td>
                    <td className="px-4 py-3 text-zinc-200">
                      <p>{booking.service.name}</p>
                      <p className="mt-0.5 text-xs text-copy-muted">{booking.service.durationMinutes} min</p>
                    </td>
                    <td className="px-4 py-3 text-zinc-200">{booking.barber.name}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-zinc-300">
                      <p className="font-semibold text-zinc-100">{dateTime.time}</p>
                      <p className="mt-0.5 text-xs text-copy-muted">{dateTime.date}</p>
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
                          aria-label="Abrir ações do agendamento"
                          className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-semibold text-zinc-200 transition hover:border-brand/60 hover:text-brand-highlight disabled:opacity-40"
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
                  <td colSpan={7} className="px-3 py-5 text-center text-copy-muted">
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
          className={`fixed z-100 w-63 rounded-xl border border-zinc-800 bg-zinc-950 p-2 shadow-2xl shadow-black/40 ${actionsMenuPlacement === "up" ? "origin-bottom-right" : "origin-top-right"
            }`}
        >
          <button
            type="button"
            role="menuitem"
            disabled={isBusy || openActionsBooking.status === "CONCLUIDO"}
            onClick={() => changeStatus(openActionsBooking.id, "CONCLUIDO")}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-brand-soft transition hover:bg-brand/10 disabled:opacity-40"
          ><span className="w-6 text-xs font-semibold">FIM</span><span>Marcar como concluído</span></button>
          <button
            type="button"
            role="menuitem"
            disabled={isBusy || openActionsBooking.status === "AUSENTE"}
            onClick={() => changeStatus(openActionsBooking.id, "AUSENTE")}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-brand-soft transition hover:bg-brand/10 disabled:opacity-40"
          ><span className="w-6 text-xs font-semibold">NA</span><span>Registrar ausencia</span></button>
          <button
            type="button"
            role="menuitem"
            disabled={isBusy || openActionsBooking.status === "CONFIRMADO"}
            onClick={() => changeStatus(openActionsBooking.id, "CONFIRMADO")}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-zinc-200 transition hover:bg-zinc-900 disabled:opacity-40"
          >
            <span className="w-6 text-xs font-semibold text-success-soft">OK</span>
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
            <span className="w-6 text-xs font-semibold text-brand-highlight">R$</span>
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
          <a
            role="menuitem"
            href={buildBookingWhatsAppUrl(openActionsBooking)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-success-soft transition hover:bg-success/10"
          >
            <span className="w-6 text-xs font-semibold text-success-soft">WA</span>
            <span>Enviar WhatsApp</span>
          </a>
          <button
            type="button"
            role="menuitem"
            disabled={isBusy || openActionsBooking.status === "CANCELADO"}
            onClick={() => changeStatus(openActionsBooking.id, "CANCELADO")}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-danger-soft transition hover:bg-danger/10 disabled:opacity-40"
          >
            <span className="w-6 text-xs font-semibold text-danger-soft">X</span>
            <span>Cancelar agendamento</span>
          </button>
          {openActionsBooking.seriesId ? <button type="button" role="menuitem" disabled={isBusy || openActionsBooking.status === "CANCELADO"} onClick={() => changeStatus(openActionsBooking.id, "CANCELADO", "FUTURE")} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-danger-soft transition hover:bg-danger/10 disabled:opacity-40"><span className="w-6 text-xs font-semibold text-danger-soft">X+</span><span>Cancelar esta e futuras</span></button> : null}
          {openActionsBooking.seriesId ? <button type="button" role="menuitem" disabled={isBusy || openActionsBooking.status === "CANCELADO"} onClick={() => changeStatus(openActionsBooking.id, "CANCELADO", "ALL")} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-danger-soft transition hover:bg-danger/10 disabled:opacity-40"><span className="w-6 text-xs font-semibold text-danger-soft">ALL</span><span>Cancelar toda a série</span></button> : null}
        </div>
      ) : null}

      {isCreateModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/75 p-4 backdrop-blur-sm">
          <div role="dialog" aria-modal="true" aria-labelledby="create-booking-title" className="ui-modal-panel max-h-[90vh] w-full max-w-2xl overflow-y-auto p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 id="create-booking-title" className="text-xl font-semibold text-zinc-100">Novo agendamento</h3>
                <p className="mt-1 text-sm text-zinc-400">
                  Crie um horário manual e, se quiser, repita como na agenda do Google.
                </p>
              </div>
              <button
                type="button"
                onClick={closeCreateModal}
                className="button-secondary px-3 py-1.5"
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
                  className="ui-control w-full px-3 py-2"
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
                  className="ui-control w-full px-3 py-2"
                />
              </label>

              <label className="space-y-2 sm:col-span-2">
                <span className="text-sm text-zinc-300">Observações</span>
                <textarea
                  value={createDraft.observations}
                  onChange={(event) => setCreateDraft((prev) => ({ ...prev, observations: event.target.value }))}
                  rows={3}
                  maxLength={500}
                  className="ui-control w-full resize-none px-3 py-2"
                />
              </label>

              <label className="space-y-2">
                <span className="text-sm text-zinc-300">Serviço</span>
                <select
                  value={createDraft.serviceId}
                  onChange={(event) => setCreateDraft((prev) => ({ ...prev, serviceId: event.target.value }))}
                  className="ui-control w-full px-3 py-2"
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
                  className="ui-control w-full px-3 py-2"
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
                  min={businessToday}
                  onChange={(event) =>
                    setCreateDraft((prev) => ({
                      ...prev,
                      date: event.target.value,
                      repeatUntil:
                        prev.recurrence === "NONE"
                          ? event.target.value
                          : getDefaultRepeatUntil(event.target.value, prev.recurrence),
                    }))
                  }
                  className="ui-control w-full px-3 py-2"
                />
              </label>

              <label className="space-y-2">
                <span className="text-sm text-zinc-300">Horário</span>
                <input
                  type="time"
                  value={createDraft.time}
                  onChange={(event) => setCreateDraft((prev) => ({ ...prev, time: event.target.value }))}
                  className="ui-control w-full px-3 py-2"
                />
              </label>
            </div>

            <div className="mt-5 rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
              <h4 className="text-sm font-semibold text-zinc-100">Repetição</h4>
              <div className="mt-3 grid gap-4 sm:grid-cols-[1fr_1fr]">
                <label className="space-y-2">
                  <span className="text-sm text-zinc-300">Frequência</span>
                  <select
                    value={createDraft.recurrence}
                    onChange={(event) => {
                      const recurrence = event.target.value as RecurrenceOption;
                      setCreateDraft((prev) => ({
                        ...prev,
                        recurrence,
                        repeatUntil: getDefaultRepeatUntil(prev.date, recurrence),
                      }));
                    }}
                    className="ui-control w-full px-3 py-2"
                  >
                    <option value="NONE">Não repetir</option>
                    <option value="DAILY">Diariamente</option>
                    <option value="WEEKLY">Toda semana no mesmo dia</option>
                    <option value="MONTHLY">Uma vez por mês no mesmo dia</option>
                  </select>
                </label>

                <label className="space-y-2">
                  <span className="text-sm text-zinc-300">Repetir até</span>
                  <input
                    type="date"
                    value={createDraft.repeatUntil}
                    min={createDraft.date}
                    disabled={createDraft.recurrence === "NONE"}
                    onChange={(event) => setCreateDraft((prev) => ({ ...prev, repeatUntil: event.target.value }))}
                    className="ui-control w-full px-3 py-2"
                  />
                </label>
              </div>
              <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-900/70 px-3 py-3">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm font-semibold text-zinc-100">
                    {getRecurrenceLabel(createDraft.recurrence, createDraft.date)}
                  </p>
                  <span
                    className={`w-fit rounded-full border px-2 py-1 text-xs font-semibold ${recurrenceHasLimitError
                      ? "border-danger/50 bg-danger/15 text-danger-soft"
                      : "border-brand/30 bg-brand/10 text-brand-soft"
                      }`}
                  >
                    {createOccurrenceStarts.length} ocorrência{createOccurrenceStarts.length === 1 ? "" : "s"}
                  </span>
                </div>
                {createOccurrencePreview.length > 0 ? (
                  <p className="mt-2 text-xs text-copy-muted">
                    Primeiros horários:{" "}
                    {createOccurrencePreview.map((item) => `${item.date} ${item.time}`).join(", ")}
                    {createOccurrenceStarts.length > createOccurrencePreview.length ? "..." : ""}
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-danger-soft">Revise a data final da repetição.</p>
                )}
                <p className="mt-2 text-xs text-copy-muted">
                  A série usa exatamente o horário selecionado. Limite: 59 ocorrências por operação.
                </p>
              </div>
            </div>

            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={closeCreateModal}
                disabled={isPendingCreate}
                className="button-secondary px-4 py-2"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleCreateBooking}
                disabled={isPendingCreate || createOccurrenceStarts.length === 0 || recurrenceHasLimitError}
                className="button-primary px-4 py-2 disabled:opacity-60"
              >
                {isPendingCreate
                  ? "Criando..."
                  : createDraft.recurrence === "NONE"
                    ? "Salvar agendamento"
                    : `Salvar ${createOccurrenceStarts.length} agendamentos`}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {editingBooking ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/75 p-4 backdrop-blur-sm">
          <div role="dialog" aria-modal="true" aria-labelledby="edit-booking-title" className="ui-modal-panel max-h-[90vh] w-full max-w-3xl overflow-y-auto p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 id="edit-booking-title" className="text-xl font-semibold text-zinc-100">Editar agendamento</h3>
                <p className="mt-1 text-sm text-zinc-400">
                  Atualize este horário e, se precisar, crie novas ocorrências a partir dele.
                </p>
              </div>
              <button
                type="button"
                onClick={closeEditModal}
                className="button-secondary px-3 py-1.5"
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
                  className="ui-control w-full px-3 py-2"
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
                  className="ui-control w-full px-3 py-2"
                />
              </label>

              <label className="space-y-2">
                <span className="text-sm text-zinc-300">Serviço</span>
                <select
                  value={editingBooking.serviceId}
                  onChange={(event) =>
                    setEditingBooking((prev) => (prev ? { ...prev, serviceId: event.target.value } : prev))
                  }
                  className="ui-control w-full px-3 py-2"
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
                  className="ui-control w-full px-3 py-2"
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
                  onChange={(event) => setEditingBooking((prev) => prev ? { ...prev, date: event.target.value } : prev)}
                  className="ui-control w-full px-3 py-2"
                />
              </label>

              <label className="space-y-2">
                <span className="text-sm text-zinc-300">Horário</span>
                <input
                  type="time"
                  value={editingBooking.time}
                  onChange={(event) =>
                    setEditingBooking((prev) => (prev ? { ...prev, time: event.target.value } : prev))
                  }
                  className="ui-control w-full px-3 py-2"
                />
              </label>
            </div>

            <div className="mt-5 rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h4 className="text-sm font-semibold text-zinc-100">Alcance da edição</h4>
                  <p className="mt-1 text-xs text-copy-muted">
                    Em uma série, escolha se a mudança vale apenas para esta ocorrência, para as futuras ou para toda a série.
                  </p>
                </div>
                <span className="w-fit rounded-full border border-zinc-700 px-2 py-1 text-xs font-semibold text-zinc-300">
                  Google Agenda
                </span>
              </div>

              <div className="mt-4 grid gap-4">
                <label className="space-y-2">
                  <span className="text-sm text-zinc-300">Aplicar em</span>
                  <select
                    value={editingBooking.scope}
                    onChange={(event) => {
                      setEditingBooking((prev) =>
                        prev ? { ...prev, scope: event.target.value as "SINGLE" | "FUTURE" | "ALL" } : prev,
                      );
                    }}
                    className="ui-control w-full px-3 py-2"
                  >
                    <option value="SINGLE">Somente esta ocorrência</option>
                    {editingBooking.seriesId ? <option value="FUTURE">Esta e as futuras</option> : null}
                    {editingBooking.seriesId ? <option value="ALL">Toda a série</option> : null}
                  </select>
                </label>

              </div>

              <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-900/70 px-3 py-3">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm font-semibold text-zinc-100">
                    {editingBooking.scope === "SINGLE" ? "Somente esta ocorrência" : editingBooking.scope === "FUTURE" ? "Esta e as futuras" : "Toda a série"}
                  </p>
                  <span className="w-fit rounded-full border border-brand/30 bg-brand/10 px-2 py-1 text-xs font-semibold text-brand-soft">
                    {editingBooking.scope === "SINGLE" ? "1 atualização" : "Atualização em série"}
                  </span>
                </div>
                <p className="mt-2 text-xs text-copy-muted">Todos os horários afetados serão revalidados atomicamente contra expediente, bloqueios e conflitos.</p>
              </div>
            </div>

            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={closeEditModal}
                disabled={isPendingCreate}
                className="button-secondary px-4 py-2"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleEditBooking}
                disabled={isPendingCreate || !editingBooking.date || !editingBooking.time}
                className="button-primary px-4 py-2 disabled:opacity-60"
              >
                {isPendingCreate ? "Salvando..." : "Salvar alterações"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
