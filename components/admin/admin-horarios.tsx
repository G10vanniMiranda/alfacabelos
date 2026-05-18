"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { replaceBarberDayAvailabilityAction } from "@/lib/actions/booking-actions";
import { isClosedDayAvailability } from "@/lib/constants/availability";
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
    if (isClosedDayAvailability(row)) {
      grouped.set(row.dayOfWeek, []);
      continue;
    }

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

function getRangeSummary(ranges: TimeRange[]) {
  if (ranges.length === 0) {
    return "Fechado";
  }

  const sorted = [...ranges].sort((a, b) => a.openTime.localeCompare(b.openTime));
  return `${sorted[0]?.openTime ?? "--:--"} - ${sorted[sorted.length - 1]?.closeTime ?? "--:--"}`;
}

function getOpenDaysCount(days: DayDraft[]) {
  return days.filter((day) => day.ranges.length > 0).length;
}

function getTotalRangesCount(days: DayDraft[]) {
  return days.reduce((total, day) => total + day.ranges.length, 0);
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
  const openDaysCount = useMemo(() => getOpenDaysCount(draftRows), [draftRows]);
  const totalRangesCount = useMemo(() => getTotalRangesCount(draftRows), [draftRows]);

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

  function setDayRanges(dayOfWeek: number, ranges: TimeRange[]) {
    setDraftRows((prev) =>
      prev.map((day) => {
        if (day.dayOfWeek !== dayOfWeek) {
          return day;
        }
        return {
          ...day,
          ranges,
        };
      }),
    );
  }

  function saveRanges(dayOfWeek: number, ranges: TimeRange[]) {
    if (hasInvalidRanges(ranges)) {
      pushToast("Revise as faixas: horario invalido ou sobreposto", "error");
      return;
    }

    startTransition(async () => {
      try {
        await replaceBarberDayAvailabilityAction({
          barberId: selectedBarberId,
          dayOfWeek,
          ranges: [...ranges].sort((a, b) => a.openTime.localeCompare(b.openTime)),
        });
        pushToast("Horarios salvos", "success");
        window.location.reload();
      } catch (error) {
        pushToast(error instanceof Error ? error.message : "Erro ao salvar horarios", "error");
      }
    });
  }

  function saveDay(day: DayDraft) {
    saveRanges(day.dayOfWeek, day.ranges);
  }

  function closeAndSaveDay(dayOfWeek: number) {
    setDayRanges(dayOfWeek, []);
    saveRanges(dayOfWeek, []);
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
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 px-5 py-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-zinc-100">Horarios disponiveis</h2>
            <p className="mt-1 max-w-2xl text-sm text-zinc-400">
              Defina a grade semanal de atendimento por barbeiro. Cada dia pode ter uma ou mais faixas.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:min-w-72">
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-zinc-500">Dias abertos</p>
              <p className="mt-1 text-2xl font-semibold text-zinc-100">{openDaysCount}/7</p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-zinc-500">Faixas</p>
              <p className="mt-1 text-2xl font-semibold text-zinc-100">{totalRangesCount}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5">
        <div className="grid gap-4 lg:grid-cols-[minmax(260px,380px)_1fr] lg:items-center">
          <label className="space-y-2">
            <span className="text-sm font-medium text-zinc-300">Barbeiro</span>
            <select
              value={selectedBarberId}
              onChange={(event) => setSelectedBarberId(event.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-zinc-100 outline-none transition focus:border-cyan-400"
            >
              {barbers.map((barber) => (
                <option key={barber.id} value={barber.id}>
                  {barber.name}
                </option>
              ))}
            </select>
          </label>

          <div className="rounded-xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-cyan-200/80">Configurando</p>
            <p className="mt-1 text-sm font-semibold text-cyan-50">{selectedBarber?.name}</p>
            <p className="mt-1 text-xs text-cyan-100/70">
              Alteracoes sao salvas por dia. Use fechar dia para bloquear a agenda semanal inteira daquele dia.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-zinc-100">Grade semanal</h3>
            <p className="mt-1 text-sm text-zinc-500">Revise os dias, ajuste faixas e salve somente o dia alterado.</p>
          </div>
          {isPending ? <p className="text-sm text-cyan-200">Salvando alteracoes...</p> : null}
        </div>

        <div className="mt-5 grid gap-4 xl:grid-cols-2">
          {draftRows.map((day) => {
            const dayLabel = WEEK_DAYS.find((item) => item.dayOfWeek === day.dayOfWeek)?.label ?? `Dia ${day.dayOfWeek}`;
            const isClosed = day.ranges.length === 0;
            const hasError = hasInvalidRanges(day.ranges);

            return (
              <div
                key={day.dayOfWeek}
                className={`rounded-xl border bg-zinc-950/70 p-4 transition ${
                  hasError ? "border-red-500/70" : isClosed ? "border-zinc-800" : "border-zinc-700"
                }`}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-base font-semibold text-zinc-100">{dayLabel}</h4>
                      <span
                        className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
                          isClosed
                            ? "border-zinc-700 bg-zinc-900 text-zinc-400"
                            : "border-emerald-400/40 bg-emerald-400/10 text-emerald-200"
                        }`}
                      >
                        {isClosed ? "Fechado" : "Aberto"}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-zinc-500">
                      {getRangeSummary(day.ranges)}
                      {!isClosed ? ` - ${day.ranges.length} faixa${day.ranges.length === 1 ? "" : "s"}` : ""}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    <button
                      type="button"
                      onClick={() => addRange(day.dayOfWeek)}
                      className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-semibold text-zinc-100 transition hover:border-cyan-400/70"
                    >
                      Adicionar faixa
                    </button>
                    <button
                      type="button"
                      onClick={() => applyTemplate(day.dayOfWeek)}
                      className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-semibold text-zinc-100 transition hover:border-cyan-400/70"
                    >
                      Modelo padrao
                    </button>
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => closeAndSaveDay(day.dayOfWeek)}
                      className="rounded-lg border border-red-500/50 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-100 transition hover:bg-red-500/15 disabled:opacity-60"
                    >
                      Fechar dia
                    </button>
                  </div>
                </div>

                <div className="mt-4 space-y-2">
                  {day.ranges.map((range, index) => (
                    <div
                      key={`${day.dayOfWeek}-${index}`}
                      className="grid gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 md:grid-cols-[1fr_1fr_auto] md:items-end"
                    >
                      <label className="space-y-1">
                        <span className="text-xs font-medium text-zinc-500">Inicio</span>
                        <input
                          type="time"
                          value={range.openTime}
                          onChange={(event) => updateRange(day.dayOfWeek, index, { openTime: event.target.value })}
                          className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100 outline-none transition focus:border-cyan-400"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-xs font-medium text-zinc-500">Fim</span>
                        <input
                          type="time"
                          value={range.closeTime}
                          onChange={(event) => updateRange(day.dayOfWeek, index, { closeTime: event.target.value })}
                          className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100 outline-none transition focus:border-cyan-400"
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => removeRange(day.dayOfWeek, index)}
                        className="rounded-lg border border-red-500/40 px-3 py-2 text-xs font-semibold text-red-100 transition hover:bg-red-500/10"
                      >
                        Remover
                      </button>
                    </div>
                  ))}

                  {day.ranges.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-900/40 px-4 py-5 text-sm text-zinc-500">
                      Dia sem atendimento.
                    </div>
                  ) : null}
                </div>

                {hasError ? (
                  <p className="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-100">
                    Corrija faixas sobrepostas ou horarios em que o fim vem antes do inicio.
                  </p>
                ) : null}

                <div className="mt-4 flex items-center justify-between gap-3 border-t border-zinc-800 pt-4">
                  <p className="text-xs text-zinc-500">
                    {isClosed ? "Nenhum horario sera exibido para clientes." : "Este dia aparece na agenda publica."}
                  </p>
                  <button
                    type="button"
                    disabled={isPending || hasError}
                    onClick={() => saveDay(day)}
                    className="shrink-0 rounded-lg bg-cyan-400 px-4 py-2 text-sm font-bold text-zinc-950 transition hover:bg-cyan-300 disabled:opacity-70"
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
