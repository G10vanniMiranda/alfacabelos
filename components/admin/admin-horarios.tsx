"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { replaceBarberDayAvailabilityAction } from "@/lib/actions/booking-actions";
import { useToast } from "@/components/ui/toast";
import { Barber, BarberAvailability } from "@/types/domain";

type AdminHorariosProps = {
  barbers: Barber[];
  availabilityByBarber: Record<string, BarberAvailability[]>;
};

type TimeRange = {
  openTime: string;
  closeTime: string;
};

type DayDraft = {
  dayOfWeek: number;
  ranges: TimeRange[];
};

const WEEK_DAYS = [
  { dayOfWeek: 0, label: "Domingo" },
  { dayOfWeek: 1, label: "Segunda" },
  { dayOfWeek: 2, label: "Terca" },
  { dayOfWeek: 3, label: "Quarta" },
  { dayOfWeek: 4, label: "Quinta" },
  { dayOfWeek: 5, label: "Sexta" },
  { dayOfWeek: 6, label: "Sabado" },
] as const;

const DEFAULT_DAY_RANGES: Record<number, TimeRange[]> = {
  0: [],
  1: [
    { openTime: "09:00", closeTime: "10:00" },
    { openTime: "10:00", closeTime: "11:00" },
    { openTime: "11:00", closeTime: "12:00" },
    { openTime: "14:00", closeTime: "15:00" },
    { openTime: "15:00", closeTime: "16:00" },
    { openTime: "16:00", closeTime: "17:00" },
    { openTime: "17:00", closeTime: "18:00" },
    { openTime: "18:00", closeTime: "19:00" },
  ],
  2: [
    { openTime: "09:00", closeTime: "10:00" },
    { openTime: "10:00", closeTime: "11:00" },
    { openTime: "11:00", closeTime: "12:00" },
    { openTime: "14:00", closeTime: "15:00" },
    { openTime: "15:00", closeTime: "16:00" },
    { openTime: "16:00", closeTime: "17:00" },
    { openTime: "17:00", closeTime: "18:00" },
    { openTime: "18:00", closeTime: "19:00" },
  ],
  3: [
    { openTime: "09:00", closeTime: "10:00" },
    { openTime: "10:00", closeTime: "11:00" },
    { openTime: "11:00", closeTime: "12:00" },
    { openTime: "14:00", closeTime: "15:00" },
    { openTime: "15:00", closeTime: "16:00" },
    { openTime: "16:00", closeTime: "17:00" },
    { openTime: "17:00", closeTime: "18:00" },
    { openTime: "18:00", closeTime: "19:00" },
  ],
  4: [
    { openTime: "09:00", closeTime: "10:00" },
    { openTime: "10:00", closeTime: "11:00" },
    { openTime: "11:00", closeTime: "12:00" },
    { openTime: "14:00", closeTime: "15:00" },
    { openTime: "15:00", closeTime: "16:00" },
    { openTime: "16:00", closeTime: "17:00" },
    { openTime: "17:00", closeTime: "18:00" },
    { openTime: "18:00", closeTime: "19:00" },
  ],
  5: [
    { openTime: "09:00", closeTime: "10:00" },
    { openTime: "10:00", closeTime: "11:00" },
    { openTime: "11:00", closeTime: "12:00" },
    { openTime: "14:00", closeTime: "15:00" },
    { openTime: "15:00", closeTime: "16:00" },
    { openTime: "16:00", closeTime: "17:00" },
    { openTime: "17:00", closeTime: "18:00" },
    { openTime: "18:00", closeTime: "19:00" },
  ],
  6: [
    { openTime: "09:00", closeTime: "10:00" },
    { openTime: "10:00", closeTime: "11:00" },
    { openTime: "11:00", closeTime: "12:00" },
    { openTime: "14:00", closeTime: "15:00" },
    { openTime: "15:00", closeTime: "16:00" },
    { openTime: "16:00", closeTime: "17:00" },
    { openTime: "17:00", closeTime: "18:00" },
    { openTime: "18:00", closeTime: "19:00" },
  ],
};

function cloneRanges(ranges: TimeRange[]) {
  return ranges.map((range) => ({ ...range }));
}

function buildDraftRows(rows: BarberAvailability[] | undefined): DayDraft[] {
  const grouped = new Map<number, TimeRange[]>();

  for (const row of rows ?? []) {
    const found = grouped.get(row.dayOfWeek) ?? [];
    found.push({ openTime: row.openTime, closeTime: row.closeTime });
    grouped.set(row.dayOfWeek, found);
  }

  return WEEK_DAYS.map(({ dayOfWeek }) => {
    const ranges = grouped.get(dayOfWeek)?.sort((a, b) => a.openTime.localeCompare(b.openTime));
    return {
      dayOfWeek,
      ranges: ranges ? cloneRanges(ranges) : cloneRanges(DEFAULT_DAY_RANGES[dayOfWeek] ?? []),
    };
  });
}

function hasInvalidRanges(ranges: TimeRange[]) {
  const sorted = [...ranges].sort((a, b) => a.openTime.localeCompare(b.openTime));

  for (let i = 0; i < sorted.length; i += 1) {
    const current = sorted[i];
    if (!current || current.openTime >= current.closeTime) {
      return true;
    }
    const next = sorted[i + 1];
    if (next && current.closeTime > next.openTime) {
      return true;
    }
  }

  return false;
}

export function AdminHorarios({ barbers, availabilityByBarber }: AdminHorariosProps) {
  const [isPending, startTransition] = useTransition();
  const { pushToast } = useToast();
  const [selectedBarberId, setSelectedBarberId] = useState(barbers[0]?.id ?? "");
  const [draftRows, setDraftRows] = useState<DayDraft[]>(() => buildDraftRows(availabilityByBarber[barbers[0]?.id ?? ""]));

  const selectedBarber = useMemo(
    () => barbers.find((barber) => barber.id === selectedBarberId),
    [barbers, selectedBarberId],
  );

  useEffect(() => {
    setDraftRows(buildDraftRows(availabilityByBarber[selectedBarberId]));
  }, [availabilityByBarber, selectedBarberId]);

  function addRange(dayOfWeek: number) {
    setDraftRows((prev) =>
      prev.map((day) => {
        if (day.dayOfWeek !== dayOfWeek) {
          return day;
        }
        return {
          ...day,
          ranges: [...day.ranges, { openTime: "09:00", closeTime: "10:00" }],
        };
      }),
    );
  }

  function removeRange(dayOfWeek: number, index: number) {
    setDraftRows((prev) =>
      prev.map((day) => {
        if (day.dayOfWeek !== dayOfWeek) {
          return day;
        }
        return {
          ...day,
          ranges: day.ranges.filter((_, idx) => idx !== index),
        };
      }),
    );
  }

  function updateRange(dayOfWeek: number, index: number, patch: Partial<TimeRange>) {
    setDraftRows((prev) =>
      prev.map((day) => {
        if (day.dayOfWeek !== dayOfWeek) {
          return day;
        }

        return {
          ...day,
          ranges: day.ranges.map((range, idx) => {
            if (idx !== index) {
              return range;
            }
            return { ...range, ...patch };
          }),
        };
      }),
    );
  }

  function applyTemplate(dayOfWeek: number) {
    setDraftRows((prev) =>
      prev.map((day) => {
        if (day.dayOfWeek !== dayOfWeek) {
          return day;
        }
        return {
          ...day,
          ranges: cloneRanges(DEFAULT_DAY_RANGES[dayOfWeek] ?? []),
        };
      }),
    );
  }

  function clearDay(dayOfWeek: number) {
    setDraftRows((prev) =>
      prev.map((day) => {
        if (day.dayOfWeek !== dayOfWeek) {
          return day;
        }
        return {
          ...day,
          ranges: [],
        };
      }),
    );
  }

  function saveDay(day: DayDraft) {
    if (hasInvalidRanges(day.ranges)) {
      pushToast("Revise as faixas: horario invalido ou sobreposto", "error");
      return;
    }

    startTransition(async () => {
      try {
        await replaceBarberDayAvailabilityAction({
          barberId: selectedBarberId,
          dayOfWeek: day.dayOfWeek,
          ranges: [...day.ranges].sort((a, b) => a.openTime.localeCompare(b.openTime)),
        });
        pushToast("Horarios salvos", "success");
        window.location.reload();
      } catch (error) {
        pushToast(error instanceof Error ? error.message : "Erro ao salvar horarios", "error");
      }
    });
  }

  if (barbers.length === 0) {
    return (
      <section className="space-y-6">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 px-5 py-4">
          <h2 className="text-2xl font-semibold text-zinc-100">Horarios disponiveis</h2>
          <p className="mt-1 text-sm text-zinc-400">Nenhum barbeiro ativo encontrado.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 px-5 py-4">
        <h2 className="text-2xl font-semibold text-zinc-100">Horarios disponiveis</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Configure por faixas, por exemplo: 09:00-10:00, 10:00-11:00, 11:00-12:00 e 14:00-19:00.
        </p>
      </div>

      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5">
        <label className="text-sm text-zinc-300">Barbeiro</label>
        <select
          value={selectedBarberId}
          onChange={(event) => setSelectedBarberId(event.target.value)}
          className="mt-2 w-full max-w-sm rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
        >
          {barbers.map((barber) => (
            <option key={barber.id} value={barber.id}>
              {barber.name}
            </option>
          ))}
        </select>
        <p className="mt-2 text-xs text-zinc-500">Configurando: {selectedBarber?.name}</p>
      </div>

      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5">
        <h3 className="text-lg font-semibold text-zinc-100">Grade semanal por faixas</h3>
        <div className="mt-4 space-y-4">
          {draftRows.map((day) => {
            const dayLabel = WEEK_DAYS.find((item) => item.dayOfWeek === day.dayOfWeek)?.label ?? `Dia ${day.dayOfWeek}`;

            return (
              <div key={day.dayOfWeek} className="rounded-lg border border-zinc-700 bg-zinc-950/70 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-sm font-semibold text-zinc-100">{dayLabel}</h4>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => addRange(day.dayOfWeek)}
                      className="rounded-md border border-zinc-600 px-2 py-1 text-xs text-zinc-100"
                    >
                      Adicionar faixa
                    </button>
                    <button
                      type="button"
                      onClick={() => applyTemplate(day.dayOfWeek)}
                      className="rounded-md border border-zinc-600 px-2 py-1 text-xs text-zinc-100"
                    >
                      Modelo padrao
                    </button>
                    <button
                      type="button"
                      onClick={() => clearDay(day.dayOfWeek)}
                      className="rounded-md border border-red-500/60 px-2 py-1 text-xs text-red-200"
                    >
                      Fechar dia
                    </button>
                  </div>
                </div>

                <div className="mt-3 space-y-2">
                  {day.ranges.map((range, index) => (
                    <div key={`${day.dayOfWeek}-${index}`} className="grid gap-2 md:grid-cols-[150px_150px_auto]">
                      <input
                        type="time"
                        value={range.openTime}
                        onChange={(event) => updateRange(day.dayOfWeek, index, { openTime: event.target.value })}
                        className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
                      />
                      <input
                        type="time"
                        value={range.closeTime}
                        onChange={(event) => updateRange(day.dayOfWeek, index, { closeTime: event.target.value })}
                        className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
                      />
                      <button
                        type="button"
                        onClick={() => removeRange(day.dayOfWeek, index)}
                        className="rounded-md border border-red-500/60 px-3 py-2 text-xs text-red-200"
                      >
                        Remover
                      </button>
                    </div>
                  ))}

                  {day.ranges.length === 0 ? (
                    <p className="text-xs text-zinc-500">Dia sem atendimento.</p>
                  ) : null}
                </div>

                <div className="mt-4">
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => saveDay(day)}
                    className="rounded-lg bg-cyan-400 px-4 py-2 text-sm font-bold text-zinc-950 disabled:opacity-70"
                  >
                    Salvar {dayLabel}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
