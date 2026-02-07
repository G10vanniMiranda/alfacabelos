"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createBookingAction } from "@/lib/actions/booking-actions";
import { formatDateInput, formatPhone } from "@/lib/utils";
import { Barber, Service } from "@/types/domain";
import { AvailableSlot, SchedulerDraft } from "@/types/scheduler";
import { useToast } from "@/components/ui/toast";
import { AvailableSlots } from "./available-slots";
import { Stepper } from "./stepper";

const STORAGE_KEY = "scheduler-draft";

export function SchedulerWizard({
  services,
  barbers,
  initialCustomer,
}: {
  services: Service[];
  barbers: Barber[];
  initialCustomer?: { name: string; phone: string };
}) {
  const router = useRouter();
  const { pushToast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<SchedulerDraft>({});
  const [slots, setSlots] = useState<AvailableSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);

  const minDate = useMemo(() => formatDateInput(new Date()), []);

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const fromStorage = JSON.parse(raw) as SchedulerDraft;
      setDraft({
        ...fromStorage,
        customerName: fromStorage.customerName || initialCustomer?.name,
        customerPhone: fromStorage.customerPhone || initialCustomer?.phone,
      });
      return;
    }
    setDraft((prev) => ({
      ...prev,
      customerName: initialCustomer?.name,
      customerPhone: initialCustomer?.phone,
    }));
  }, [initialCustomer?.name, initialCustomer?.phone]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
  }, [draft]);

  const loadSlots = useCallback(async (date: string, barberId?: string, serviceId?: string) => {
    if (!date || !barberId || !serviceId) {
      setSlots([]);
      return;
    }

    setSlotsLoading(true);
    try {
      const response = await fetch(
        `/api/available-slots?date=${date}&barberId=${barberId}&serviceId=${serviceId}`,
      );
      const data = (await response.json()) as AvailableSlot[] | { message: string };
      if (!response.ok || !Array.isArray(data)) {
        throw new Error((data as { message: string }).message ?? "Falha ao carregar horarios");
      }
      setSlots(data);
    } catch (error) {
      setSlots([]);
      pushToast(error instanceof Error ? error.message : "Erro ao carregar horarios", "error");
    } finally {
      setSlotsLoading(false);
    }
  }, [pushToast]);

  useEffect(() => {
    if (step === 3 && draft.date && draft.barberId && draft.serviceId) {
      loadSlots(draft.date, draft.barberId, draft.serviceId);
    }
  }, [step, draft.date, draft.barberId, draft.serviceId, loadSlots]);

  function canAdvance(): boolean {
    if (step === 1) {
      return Boolean(draft.serviceId);
    }
    if (step === 2) {
      return Boolean(draft.barberId);
    }
    if (step === 3) {
      return Boolean(draft.date && draft.time);
    }
    return Boolean(draft.customerName && draft.customerPhone);
  }

  function submitBooking() {
    if (!draft.serviceId || !draft.barberId || !draft.time || !draft.customerName || !draft.customerPhone) {
      pushToast("Preencha todos os campos para confirmar", "error");
      return;
    }

    const payload = {
      serviceId: draft.serviceId,
      barberId: draft.barberId,
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
  const selectedBarber = barbers.find((item) => item.id === draft.barberId);

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5 sm:p-8">
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
              <p className="text-sm text-zinc-400">{service.durationMinutes} minutos</p>
              <p className="text-sm text-cyan-200">R$ {(service.priceCents / 100).toFixed(2)}</p>
            </button>
          ))}
        </div>
      )}

      {step === 2 && (
        <div className="mt-6 grid gap-3 sm:grid-cols-2 md:grid-cols-3">
          {barbers.map((barber) => (
            <button
              type="button"
              key={barber.id}
              onClick={() => setDraft((prev) => ({ ...prev, barberId: barber.id }))}
              className={`rounded-lg border p-4 text-left transition ${
                draft.barberId === barber.id
                  ? "border-cyan-300 bg-cyan-500/10"
                  : "border-zinc-700 bg-zinc-900 hover:border-cyan-500"
              }`}
            >
              <p className="font-semibold text-zinc-100">{barber.name}</p>
              <p className="text-sm text-zinc-400">Barbeiro especialista</p>
            </button>
          ))}
        </div>
      )}

      {step === 3 && (
        <div className="mt-6">
          <label className="text-sm text-zinc-300">Selecione a data</label>
          <input
            type="date"
            min={minDate}
            value={draft.date ?? ""}
            onChange={(event) => {
              const date = event.target.value;
              setDraft((prev) => ({ ...prev, date, time: undefined }));
              loadSlots(date, draft.barberId, draft.serviceId);
            }}
            className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
          />
          <AvailableSlots
            slots={slots}
            selectedStart={draft.time}
            loading={slotsLoading}
            onSelect={(slot) => setDraft((prev) => ({ ...prev, time: slot.start }))}
          />
        </div>
      )}

      {step === 4 && (
        <div className="mt-6 space-y-4">
          <div className="rounded-lg border border-zinc-700 bg-zinc-950/70 p-4 text-sm text-zinc-300">
            <p>Servico: {selectedService?.name}</p>
            <p>Barbeiro: {selectedBarber?.name}</p>
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

      <div className="mt-8 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setStep((prev) => Math.max(1, prev - 1))}
          disabled={step === 1 || isPending}
          className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-200 disabled:opacity-50"
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
            className="rounded-lg bg-cyan-400 px-4 py-2 text-sm font-bold text-zinc-950"
          >
            Continuar
          </button>
        ) : (
          <button
            type="button"
            onClick={submitBooking}
            disabled={isPending}
            className="rounded-lg bg-cyan-400 px-5 py-2 text-sm font-bold text-zinc-950 disabled:opacity-70"
          >
            {isPending ? "Confirmando..." : "Confirmar agendamento"}
          </button>
        )}
      </div>
    </section>
  );
}

