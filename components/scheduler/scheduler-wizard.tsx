"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClientBookingsAction } from "@/lib/actions/booking-actions";
import { BUSINESS_CONFIG } from "@/lib/config";
import {
  formatBRLFromCents,
  formatPhone,
  getLocalDateInput,
  getTimeLabelInTimeZone,
  getTodayInTimeZone,
  zonedDateTimeToUtcIso,
} from "@/lib/utils";
import { Barber, Service } from "@/types/domain";
import { AvailableSlot, SchedulerDraft } from "@/types/scheduler";
import { useToast } from "@/components/ui/toast";
import { AvailableSlots } from "./available-slots";
import { DateCalendar } from "./date-calendar";
import { Stepper } from "./stepper";

const STORAGE_KEY = "scheduler-draft";
type RecurrenceOption = "NONE" | "DAILY" | "WEEKLY" | "MONTHLY";
type RecurrenceDraft = {
  date?: string;
  time?: string;
  recurrence?: RecurrenceOption;
  repeatUntil?: string;
};

function formatFullDate(date?: string): string {
  if (!date) {
    return "Selecione um dia";
  }

  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  }).format(new Date(`${date}T12:00:00`));
}

function formatBookingTime(iso?: string): string {
  if (!iso) {
    return "Horario pendente";
  }

  return getTimeLabelInTimeZone(iso, BUSINESS_CONFIG.timezone);
}

async function fetchAvailableSlots(date: string, serviceId: string, barberId: string, signal?: AbortSignal) {
  const response = await fetch(
    `/api/available-slots?date=${date}&barberId=${barberId}&serviceId=${serviceId}`,
    {
      cache: "no-store",
      signal,
    },
  );
  const data = (await response.json()) as AvailableSlot[] | { message: string };
  if (!response.ok || !Array.isArray(data)) {
    throw new Error((data as { message: string }).message ?? "Falha ao carregar horarios");
  }

  return data;
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
    return toDateInput(targetYear, targetMonth, Math.min(day, daysInMonth(targetYear, targetMonth)));
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
    return addMonthsToDateInput(date, 3);
  }
  return date;
}

function getRecurrenceLabel(recurrence: RecurrenceOption, date?: string) {
  if (recurrence === "DAILY") {
    return "Todos os dias";
  }
  if (recurrence === "WEEKLY") {
    const label = date
      ? new Intl.DateTimeFormat("pt-BR", { weekday: "long" }).format(new Date(`${date}T12:00:00`))
      : "semana";
    return `Toda semana, ${label}`;
  }
  if (recurrence === "MONTHLY") {
    return `Todo mes${date ? `, dia ${parseDateParts(date).day}` : ""}`;
  }
  return "Nao repetir";
}

function buildOccurrenceStarts(draft: RecurrenceDraft) {
  if (!draft.date || !draft.time) {
    return [];
  }

  const recurrence = draft.recurrence ?? "NONE";
  const time = getTimeLabelInTimeZone(draft.time, BUSINESS_CONFIG.timezone);
  if (recurrence === "NONE") {
    return [zonedDateTimeToUtcIso(draft.date, `${time}:00`, BUSINESS_CONFIG.timezone)];
  }

  if (!draft.repeatUntil || draft.repeatUntil < draft.date) {
    return [];
  }

  const starts: string[] = [];
  for (let step = 0; step < 60; step += 1) {
    const date = addDateByRecurrence(draft.date, recurrence, step);
    if (date > draft.repeatUntil) {
      break;
    }
    starts.push(zonedDateTimeToUtcIso(date, `${time}:00`, BUSINESS_CONFIG.timezone));
  }

  return starts;
}

export function SchedulerWizard({
  services,
  barbers,
  initialSelection,
  initialCustomer,
}: {
  services: Service[];
  barbers: Barber[];
  initialSelection?: { serviceId?: string; barberId?: string; rescheduleBookingId?: string };
  initialCustomer?: { name: string; phone: string };
}) {
  const router = useRouter();
  const { pushToast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<SchedulerDraft>({ ...initialSelection });
  const [slots, setSlots] = useState<AvailableSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const slotsRequestRef = useRef<AbortController | null>(null);

  const minDate = useMemo(() => getTodayInTimeZone(BUSINESS_CONFIG.timezone), []);
  const occurrenceStarts = useMemo(() => buildOccurrenceStarts(draft), [draft]);
  const occurrencePreview = useMemo(() => {
    return occurrenceStarts.slice(0, 3).map((start) => ({
      date: formatFullDate(getLocalDateInput(start, BUSINESS_CONFIG.timezone)),
      time: getTimeLabelInTimeZone(start, BUSINESS_CONFIG.timezone),
    }));
  }, [occurrenceStarts]);
  const recurrence = draft.recurrence ?? "NONE";
  const recurrenceHasLimitError = recurrence !== "NONE" && occurrenceStarts.length >= 60;

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const fromStorage = JSON.parse(raw) as SchedulerDraft;
        const storedRecurrence = ["NONE", "DAILY", "WEEKLY", "MONTHLY"].includes(fromStorage.recurrence ?? "")
          ? fromStorage.recurrence
          : "NONE";
        setDraft({
          ...fromStorage,
          serviceId: initialSelection?.serviceId ?? (services.some((service) => service.id === fromStorage.serviceId) ? fromStorage.serviceId : undefined),
          barberId: initialSelection?.barberId ?? (barbers.some((barber) => barber.id === fromStorage.barberId) ? fromStorage.barberId : undefined),
          recurrence: storedRecurrence,
          repeatUntil: fromStorage.repeatUntil ?? fromStorage.date,
          customerName: fromStorage.customerName || initialCustomer?.name,
          customerPhone: fromStorage.customerPhone || initialCustomer?.phone,
        });
        return;
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    }

    setDraft((prev) => ({
      ...prev,
      ...initialSelection,
      recurrence: "NONE",
      customerName: initialCustomer?.name,
      customerPhone: initialCustomer?.phone,
    }));
  }, [barbers, services, initialCustomer?.name, initialCustomer?.phone, initialSelection]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
  }, [draft]);

  useEffect(() => {
    if (step === 3 && draft.serviceId && draft.barberId && !draft.date) {
      setDraft((prev) => ({ ...prev, date: minDate, repeatUntil: minDate }));
    }
  }, [draft.barberId, draft.date, draft.serviceId, minDate, step]);

  const loadSlots = useCallback(
    async (date: string, serviceId?: string) => {
      slotsRequestRef.current?.abort();

      if (!date || !serviceId) {
        setSlots([]);
        return;
      }

      const controller = new AbortController();
      slotsRequestRef.current = controller;
      setSlotsLoading(true);

      try {
      if (!draft.barberId) {
        setSlots([]);
        return;
      }
      const data = await fetchAvailableSlots(date, serviceId, draft.barberId, controller.signal);

        setSlots(data);
        setDraft((prev) => {
          if (!prev.time || data.some((slot) => slot.start === prev.time)) {
            return prev;
          }

          return { ...prev, time: undefined };
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        setSlots([]);
        pushToast(error instanceof Error ? error.message : "Erro ao carregar horarios", "error");
      } finally {
        if (slotsRequestRef.current === controller) {
          slotsRequestRef.current = null;
          setSlotsLoading(false);
        }
      }
    },
    [draft.barberId, pushToast],
  );

  useEffect(() => {
    if (step === 3 && draft.date && draft.serviceId && draft.barberId) {
      loadSlots(draft.date, draft.serviceId);
    }
  }, [step, draft.date, draft.serviceId, draft.barberId, loadSlots]);

  useEffect(() => {
    return () => slotsRequestRef.current?.abort();
  }, []);

  function canAdvance(): boolean {
    if (step === 1) {
      return Boolean(draft.serviceId);
    }
    if (step === 2) {
      return Boolean(draft.barberId);
    }
    if (step === 3) {
      return Boolean(
        draft.date &&
          draft.time &&
          slots.some((slot) => slot.start === draft.time) &&
          occurrenceStarts.length > 0 &&
          !recurrenceHasLimitError,
      );
    }
    return Boolean(draft.customerName && draft.customerPhone);
  }

  function submitBooking() {
    if (isPending) {
      return;
    }

    if (!draft.serviceId || !draft.barberId || !draft.time || !draft.customerName || !draft.customerPhone) {
      pushToast("Preencha todos os campos para confirmar", "error");
      return;
    }

    const serviceId = draft.serviceId;
    const barberId = draft.barberId;
    const starts = occurrenceStarts.length > 0 ? occurrenceStarts : [draft.time];
    const firstStart = starts[0] ?? draft.time;
    const payload = {
      serviceId,
      barberId,
      start: firstStart,
      starts,
      recurrence,
      repeatUntil: recurrence === "NONE" ? undefined : draft.repeatUntil,
      customerName: draft.customerName,
      customerPhone: draft.customerPhone,
      rescheduleBookingId: initialSelection?.rescheduleBookingId,
    };

    startTransition(async () => {
      if (!draft.date) {
        pushToast("Selecione uma data para confirmar", "error");
        setStep(3);
        return;
      }

      if (starts.length === 0 || recurrenceHasLimitError) {
        pushToast("Revise a frequencia do agendamento", "error");
        setStep(3);
        return;
      }

      try {
        for (const start of starts) {
          const date = getLocalDateInput(start, BUSINESS_CONFIG.timezone);
          const freshSlots = await fetchAvailableSlots(date, serviceId, barberId);
          const stillAvailable = freshSlots.some((slot) => slot.start === start);
          if (!stillAvailable) {
            if (date === draft.date) {
              setSlots(freshSlots);
            }
            setDraft((prev) => ({ ...prev, time: date === draft.date ? undefined : prev.time }));
            setStep(3);
            pushToast("Uma das repeticoes ja esta ocupada. Ajuste a frequencia ou escolha outro horario.", "error");
            return;
          }
        }
      } catch (error) {
        pushToast(error instanceof Error ? error.message : "Erro ao validar horario", "error");
        return;
      }

      const result = await createClientBookingsAction(payload);

      if (!result.success || !result.bookingId) {
        pushToast(result.message, "error");
        return;
      }

      localStorage.removeItem(STORAGE_KEY);
      pushToast("Agendamento confirmado", "success");
      router.push("/cliente");
    });
  }

  const selectedService = services.find((item) => item.id === draft.serviceId);
  const selectedBarber = barbers.find((item) => item.id === draft.barberId);
  const selectedDateLabel = formatFullDate(draft.date);
  const selectedTimeLabel = formatBookingTime(draft.time);
  const selectedServicePrice = selectedService ? formatBRLFromCents(selectedService.priceCents) : "-";

  return (
    <section className="premium-card rounded-3xl p-4 sm:p-6">
      {initialSelection?.rescheduleBookingId ? (
        <div role="status" className="mb-5 rounded-2xl border border-amber-200/30 bg-amber-200/10 p-4 text-sm text-amber-100">
          Você está reagendando um horário existente. O horário antigo só será liberado depois da confirmação do novo.
        </div>
      ) : null}
      <Stepper currentStep={step} />

      {step === 1 && (
        <div className="mt-6">
          <div className="mb-4">
            <p className="text-base font-semibold text-zinc-100">Escolha o servico</p>
            <p className="mt-1 text-sm text-zinc-400">O tempo do servico define os horarios que ficam disponiveis.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
          {services.map((service) => (
            <button
              type="button"
              key={service.id}
              onClick={() => setDraft((prev) => ({ ...prev, serviceId: service.id, time: undefined }))}
              className={`rounded-xl border p-4 text-left transition ${
                draft.serviceId === service.id
                  ? "border-amber-200/70 bg-amber-200/10 shadow-lg shadow-black/20"
                  : "border-zinc-800 bg-zinc-950/50 hover:border-amber-200/40 hover:bg-zinc-950"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-zinc-50">{service.name}</p>
                  <p className="mt-1 text-xs text-zinc-500">{service.durationMinutes} minutos</p>
                </div>
                <p className="rounded-full border border-zinc-700 px-3 py-1 text-xs font-semibold text-amber-100">
                  {formatBRLFromCents(service.priceCents)}
                </p>
              </div>
            </button>
          ))}
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="mt-6">
          <p className="text-base font-semibold text-zinc-100">Com quem você quer agendar?</p>
          <p className="mt-1 text-sm text-zinc-400">Escolha o profissional para consultar a agenda individual.</p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {barbers.map((barber) => {
              const selected = draft.barberId === barber.id;
              return (
                <button
                  type="button"
                  key={barber.id}
                  aria-pressed={selected}
                  onClick={() => setDraft((prev) => ({ ...prev, barberId: barber.id, date: undefined, time: undefined }))}
                  className={`flex min-h-24 items-center gap-4 rounded-2xl border p-4 text-left transition ${selected ? "border-amber-200/70 bg-amber-200/10" : "border-zinc-800 bg-zinc-950/50 hover:border-amber-200/40"}`}
                >
                  <span className={`grid size-12 shrink-0 place-items-center rounded-full text-lg font-black ${selected ? "bg-amber-200 text-zinc-950" : "bg-zinc-800 text-zinc-300"}`}>
                    {barber.name.charAt(0).toUpperCase()}
                  </span>
                  <span><span className="block font-semibold text-zinc-100">{barber.name}</span><span className="mt-1 block text-xs text-zinc-500">Ver agenda disponível</span></span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,360px)_1fr]">
          <div className="space-y-4">
            <div className="flex flex-col gap-1">
              <div>
                <p className="text-base font-semibold text-zinc-100">Escolha a data</p>
                <p className="text-sm capitalize text-zinc-400">{selectedDateLabel}</p>
              </div>
            </div>

            <DateCalendar
              density="compact"
              minDate={minDate}
              selectedDate={draft.date}
              onSelect={(date) => {
                setDraft((prev) => ({
                  ...prev,
                  date,
                  time: undefined,
                  repeatUntil:
                    (prev.recurrence ?? "NONE") === "NONE"
                      ? date
                      : getDefaultRepeatUntil(date, prev.recurrence ?? "NONE"),
                }));
              }}
            />

            <aside className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Resumo</p>
                  <p className="mt-2 text-sm font-semibold text-zinc-100">{selectedService?.name ?? "-"}</p>
                </div>
                <span className="rounded-full border border-zinc-700 px-2.5 py-1 text-xs font-semibold text-cyan-100">
                  {selectedServicePrice}
                </span>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
                  <p className="text-xs text-zinc-500">Dia</p>
                  <p className="mt-1 font-semibold capitalize text-zinc-100">{selectedDateLabel}</p>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
                  <p className="text-xs text-zinc-500">Horario</p>
                  <p className="mt-1 font-semibold text-cyan-100">{selectedTimeLabel}</p>
                </div>
              </div>
            </aside>
          </div>

          <div className="space-y-4">
            <div>
              <p className="text-base font-semibold text-zinc-100">Escolha o horario</p>
              <p className="mt-1 text-sm text-zinc-400">Horarios ocupados nao aparecem para selecao.</p>
            </div>
            <AvailableSlots
              slots={slots}
              selectedStart={draft.time}
              loading={slotsLoading}
              onSelect={(slot) => setDraft((prev) => ({ ...prev, time: slot.start }))}
            />

            <section className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-zinc-100">Frequencia</p>
                  <p className="text-xs text-zinc-500">Repita esse mesmo horario se for um atendimento fixo.</p>
                </div>
                <span
                  className={`w-fit rounded-full border px-2.5 py-1 text-xs font-semibold ${
                    recurrenceHasLimitError
                      ? "border-red-400/50 bg-red-500/15 text-red-100"
                      : "border-cyan-400/30 bg-cyan-400/10 text-cyan-100"
                  }`}
                >
                  {recurrence === "NONE" ? "1 horario" : `${occurrenceStarts.length} horarios`}
                </span>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-sm text-zinc-300">Repetir</span>
                  <select
                    value={recurrence}
                    onChange={(event) => {
                      const nextRecurrence = event.target.value as RecurrenceOption;
                      setDraft((prev) => ({
                        ...prev,
                        recurrence: nextRecurrence,
                        repeatUntil: getDefaultRepeatUntil(prev.date ?? minDate, nextRecurrence),
                      }));
                    }}
                    className="h-11 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-zinc-100 outline-none transition focus:border-cyan-300"
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
                    value={draft.repeatUntil ?? draft.date ?? minDate}
                    min={draft.date ?? minDate}
                    disabled={recurrence === "NONE"}
                    onChange={(event) => setDraft((prev) => ({ ...prev, repeatUntil: event.target.value }))}
                    className="h-11 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-zinc-100 outline-none transition disabled:opacity-50 focus:border-cyan-300"
                  />
                </label>
              </div>

              <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-3">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm font-semibold text-zinc-100">{getRecurrenceLabel(recurrence, draft.date)}</p>
                  <p className="text-xs text-zinc-500">
                    {recurrence === "NONE" ? "Sem repeticao" : `Ate ${formatFullDate(draft.repeatUntil)}`}
                  </p>
                </div>
                {occurrencePreview.length > 0 ? (
                  <p className="mt-2 text-xs text-zinc-400">
                    Previa: {occurrencePreview.map((item) => `${item.date} as ${item.time}`).join(", ")}
                    {occurrenceStarts.length > occurrencePreview.length ? "..." : ""}
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-amber-100">Escolha data, horario e periodo para calcular a repeticao.</p>
                )}
                {recurrenceHasLimitError ? (
                  <p className="mt-2 text-xs text-red-100">Reduza o periodo para menos de 60 agendamentos.</p>
                ) : null}
              </div>
            </section>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="space-y-4">
            <div>
              <p className="text-base font-semibold text-zinc-100">Confirme seus dados</p>
              <p className="mt-1 text-sm text-zinc-400">Usaremos essas informacoes para identificar seu agendamento.</p>
            </div>

            <div>
              <label className="text-sm font-medium text-zinc-300">Nome completo</label>
              <input
                type="text"
                value={draft.customerName ?? ""}
                onChange={(event) => setDraft((prev) => ({ ...prev, customerName: event.target.value }))}
                className="mt-2 h-12 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-zinc-100 outline-none transition focus:border-cyan-300"
              />
            </div>

            <div>
              <label className="text-sm font-medium text-zinc-300">Telefone</label>
              <input
                type="text"
                value={draft.customerPhone ?? ""}
                onChange={(event) =>
                  setDraft((prev) => ({ ...prev, customerPhone: formatPhone(event.target.value) }))
                }
                placeholder="(11) 99999-9999"
                className="mt-2 h-12 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-zinc-100 outline-none transition focus:border-cyan-300"
              />
            </div>
          </div>

          <aside className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Agendamento</p>
            <div className="mt-4 space-y-3 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-zinc-500">Servico</span>
                <span className="font-semibold text-zinc-100">{selectedService?.name ?? "-"}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-zinc-500">Barbeiro</span>
                <span className="font-semibold text-zinc-100">{selectedBarber?.name ?? "-"}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-zinc-500">Dia</span>
                <span className="text-right font-semibold capitalize text-zinc-100">{selectedDateLabel}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-zinc-500">Horario</span>
                <span className="font-semibold text-cyan-100">{selectedTimeLabel}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-zinc-500">Frequencia</span>
                <span className="text-right font-semibold text-zinc-100">
                  {recurrence === "NONE" ? "Nao repetir" : `${getRecurrenceLabel(recurrence, draft.date)} (${occurrenceStarts.length})`}
                </span>
              </div>
              <div className="flex justify-between gap-4 border-t border-zinc-800 pt-3">
                <span className="text-zinc-500">Valor</span>
                <span className="font-semibold text-zinc-100">{selectedServicePrice}</span>
              </div>
            </div>
            <p className="mt-5 border-t border-zinc-800 pt-4 text-xs leading-5 text-zinc-500">
              Ao confirmar, seu horário será reservado. Se precisar cancelar, avise a equipe com antecedência pela sua área.
            </p>
          </aside>
        </div>
      )}

      <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          onClick={() => setStep((prev) => Math.max(1, prev - 1))}
          disabled={step === 1 || isPending}
          className="w-full rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-200 disabled:opacity-50 sm:w-auto"
        >
          Voltar
        </button>

        {step < 4 ? (
          <button
            type="button"
            onClick={() => {
              if (!canAdvance()) {
                pushToast("Conclua o passo atual para avancar", "error");
                return;
              }
              setStep((prev) => Math.min(4, prev + 1));
            }}
            className="button-primary w-full sm:w-auto"
          >
            Continuar
          </button>
        ) : (
          <button
            type="button"
            onClick={submitBooking}
            disabled={isPending}
            className="button-primary w-full disabled:opacity-70 sm:w-auto"
          >
            {isPending ? "Confirmando..." : initialSelection?.rescheduleBookingId ? "Confirmar reagendamento" : "Confirmar agendamento"}
          </button>
        )}
      </div>
    </section>
  );
}
