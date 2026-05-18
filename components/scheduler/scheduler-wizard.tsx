"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createBookingAction } from "@/lib/actions/booking-actions";
import { DEFAULT_BARBER_ID, DEFAULT_BARBER_NAME } from "@/lib/constants/barber";
import { formatDateInput, formatPhone } from "@/lib/utils";
import { Service } from "@/types/domain";
import { AvailableSlot, SchedulerDraft } from "@/types/scheduler";
import { useToast } from "@/components/ui/toast";
import { AvailableSlots } from "./available-slots";
import { DateCalendar } from "./date-calendar";
import { Stepper } from "./stepper";

const STORAGE_KEY = "scheduler-draft";

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

  return new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function SchedulerWizard({
  services,
  initialCustomer,
}: {
  services: Service[];
  initialCustomer?: { name: string; phone: string };
}) {
  const router = useRouter();
  const { pushToast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<SchedulerDraft>({ barberId: DEFAULT_BARBER_ID });
  const [slots, setSlots] = useState<AvailableSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const slotsRequestRef = useRef<AbortController | null>(null);

  const minDate = useMemo(() => formatDateInput(new Date()), []);

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const fromStorage = JSON.parse(raw) as SchedulerDraft;
      setDraft({
        ...fromStorage,
        barberId: DEFAULT_BARBER_ID,
        customerName: fromStorage.customerName || initialCustomer?.name,
        customerPhone: fromStorage.customerPhone || initialCustomer?.phone,
      });
      return;
    }

    setDraft((prev) => ({
      ...prev,
      barberId: DEFAULT_BARBER_ID,
      customerName: initialCustomer?.name,
      customerPhone: initialCustomer?.phone,
    }));
  }, [initialCustomer?.name, initialCustomer?.phone]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
  }, [draft]);

  useEffect(() => {
    if (step === 2 && draft.serviceId && !draft.date) {
      setDraft((prev) => ({ ...prev, date: minDate }));
    }
  }, [draft.date, draft.serviceId, minDate, step]);

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
        const response = await fetch(
          `/api/available-slots?date=${date}&barberId=${DEFAULT_BARBER_ID}&serviceId=${serviceId}`,
          { signal: controller.signal },
        );
        const data = (await response.json()) as AvailableSlot[] | { message: string };
        if (!response.ok || !Array.isArray(data)) {
          throw new Error((data as { message: string }).message ?? "Falha ao carregar horarios");
        }

        setSlots(data);
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
    [pushToast],
  );

  useEffect(() => {
    if (step === 2 && draft.date && draft.serviceId) {
      loadSlots(draft.date, draft.serviceId);
    }
  }, [step, draft.date, draft.serviceId, loadSlots]);

  useEffect(() => {
    return () => slotsRequestRef.current?.abort();
  }, []);

  function canAdvance(): boolean {
    if (step === 1) {
      return Boolean(draft.serviceId);
    }
    if (step === 2) {
      return Boolean(draft.date && draft.time);
    }
    return Boolean(draft.customerName && draft.customerPhone);
  }

  function submitBooking() {
    if (!draft.serviceId || !draft.time || !draft.customerName || !draft.customerPhone) {
      pushToast("Preencha todos os campos para confirmar", "error");
      return;
    }

    const payload = {
      serviceId: draft.serviceId,
      start: draft.time,
      customerName: draft.customerName,
      customerPhone: draft.customerPhone,
    };

    startTransition(async () => {
      const result = await createBookingAction(payload);

      if (!result.success || !result.bookingId) {
        pushToast(result.message, "error");
        return;
      }

      localStorage.removeItem(STORAGE_KEY);
      pushToast("Agendamento confirmado", "success");
      router.push(`/confirmacao?id=${result.bookingId}`);
    });
  }

  const selectedService = services.find((item) => item.id === draft.serviceId);
  const selectedDateLabel = formatFullDate(draft.date);
  const selectedTimeLabel = formatBookingTime(draft.time);

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4 sm:p-8">
      <Stepper currentStep={step} />

      {step === 1 && (
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {services.map((service) => (
            <button
              type="button"
              key={service.id}
              onClick={() => setDraft((prev) => ({ ...prev, serviceId: service.id }))}
              className={`rounded-lg border p-4 text-left transition ${
                draft.serviceId === service.id
                  ? "border-cyan-300 bg-cyan-500/10"
                  : "border-zinc-700 bg-zinc-900 hover:border-cyan-500"
              }`}
            >
              <p className="font-semibold text-zinc-50">{service.name}</p>
              <p className="text-sm text-cyan-200">R$ {(service.priceCents / 100).toFixed(2)}</p>
            </button>
          ))}
        </div>
      )}

      {step === 2 && (
        <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
          <div>
            <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-zinc-100">Escolha na agenda</p>
                <p className="text-sm capitalize text-zinc-400">{selectedDateLabel}</p>
              </div>
              {selectedService ? (
                <span className="w-fit rounded-full border border-zinc-700 px-3 py-1 text-xs font-semibold text-cyan-100">
                  {selectedService.name} - {selectedService.durationMinutes} min
                </span>
              ) : null}
            </div>

            <DateCalendar
              minDate={minDate}
              selectedDate={draft.date}
              onSelect={(date) => {
                setDraft((prev) => ({ ...prev, date, time: undefined }));
              }}
            />
          </div>

          <aside className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4 lg:mt-7">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Resumo</p>
            <div className="mt-4 space-y-4">
              <div>
                <p className="text-xs text-zinc-500">Servico</p>
                <p className="mt-1 text-sm font-semibold text-zinc-100">{selectedService?.name ?? "-"}</p>
              </div>
              <div>
                <p className="text-xs text-zinc-500">Dia</p>
                <p className="mt-1 text-sm font-semibold capitalize text-zinc-100">{selectedDateLabel}</p>
              </div>
              <div>
                <p className="text-xs text-zinc-500">Horario</p>
                <p className="mt-1 text-sm font-semibold text-cyan-100">{selectedTimeLabel}</p>
              </div>
              <div className="rounded-lg border border-cyan-400/20 bg-cyan-400/10 px-3 py-2 text-xs text-cyan-50">
                O horario fica reservado apenas depois da confirmacao.
              </div>
            </div>
          </aside>

          <div className="lg:col-span-2">
            <AvailableSlots
              slots={slots}
              selectedStart={draft.time}
              loading={slotsLoading}
              onSelect={(slot) => setDraft((prev) => ({ ...prev, time: slot.start }))}
            />
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="mt-6 space-y-4">
          <div className="rounded-lg border border-zinc-700 bg-zinc-950/70 p-4 text-sm text-zinc-300">
            <p>Servico: {selectedService?.name}</p>
            <p>Barbeiro: {DEFAULT_BARBER_NAME}</p>
            <p>Horario: {draft.time ? new Date(draft.time).toLocaleString("pt-BR") : "-"}</p>
          </div>

          <div>
            <label className="text-sm text-zinc-300">Nome completo</label>
            <input
              type="text"
              value={draft.customerName ?? ""}
              onChange={(event) => setDraft((prev) => ({ ...prev, customerName: event.target.value }))}
              className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
            />
          </div>

          <div>
            <label className="text-sm text-zinc-300">Telefone</label>
            <input
              type="text"
              value={draft.customerPhone ?? ""}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, customerPhone: formatPhone(event.target.value) }))
              }
              placeholder="(11) 99999-9999"
              className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
            />
          </div>
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

        {step < 3 ? (
          <button
            type="button"
            onClick={() => {
              if (!canAdvance()) {
                pushToast("Conclua o passo atual para avancar", "error");
                return;
              }
              setStep((prev) => Math.min(3, prev + 1));
            }}
            className="w-full rounded-lg bg-cyan-400 px-4 py-2 text-sm font-bold text-zinc-950 sm:w-auto"
          >
            Continuar
          </button>
        ) : (
          <button
            type="button"
            onClick={submitBooking}
            disabled={isPending}
            className="w-full rounded-lg bg-cyan-400 px-5 py-2 text-sm font-bold text-zinc-950 disabled:opacity-70 sm:w-auto"
          >
            {isPending ? "Confirmando..." : "Confirmar agendamento"}
          </button>
        )}
      </div>
    </section>
  );
}
