"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { replaceBarberDayAvailabilityAction } from "@/lib/actions/booking-actions";
import { isClosedDayAvailability } from "@/lib/constants/availability";
import { useToast } from "@/components/ui/toast";
import type { Barber, BarberAvailability } from "@/types/domain";

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
  { dayOfWeek: 0, label: "Domingo", shortLabel: "Dom" },
  { dayOfWeek: 1, label: "Segunda-feira", shortLabel: "Seg" },
  { dayOfWeek: 2, label: "Terça-feira", shortLabel: "Ter" },
  { dayOfWeek: 3, label: "Quarta-feira", shortLabel: "Qua" },
  { dayOfWeek: 4, label: "Quinta-feira", shortLabel: "Qui" },
  { dayOfWeek: 5, label: "Sexta-feira", shortLabel: "Sex" },
  { dayOfWeek: 6, label: "Sábado", shortLabel: "Sáb" },
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

function cloneDays(days: DayDraft[]) {
  return days.map((day) => ({ ...day, ranges: cloneRanges(day.ranges) }));
}

function normalizeRanges(ranges: TimeRange[]) {
  return [...ranges].sort((a, b) => {
    const byOpening = a.openTime.localeCompare(b.openTime);
    return byOpening === 0 ? a.closeTime.localeCompare(b.closeTime) : byOpening;
  });
}

function rangesMatch(left: TimeRange[], right: TimeRange[]) {
  return JSON.stringify(normalizeRanges(left)) === JSON.stringify(normalizeRanges(right));
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
    const ranges = grouped.get(dayOfWeek);
    return {
      dayOfWeek,
      ranges: ranges ? cloneRanges(normalizeRanges(ranges)) : cloneRanges(DEFAULT_DAY_RANGES[dayOfWeek] ?? []),
    };
  });
}

function hasInvalidRanges(ranges: TimeRange[]) {
  const sorted = normalizeRanges(ranges);

  for (let index = 0; index < sorted.length; index += 1) {
    const current = sorted[index];
    if (!current || current.openTime >= current.closeTime) return true;
    const next = sorted[index + 1];
    if (next && current.closeTime > next.openTime) return true;
  }

  return false;
}

function getRangeSummary(ranges: TimeRange[]) {
  if (ranges.length === 0) return "Sem atendimento";
  const sorted = normalizeRanges(ranges);
  return `${sorted[0]?.openTime ?? "--:--"} às ${sorted[sorted.length - 1]?.closeTime ?? "--:--"}`;
}

function getDayLabel(dayOfWeek: number) {
  return WEEK_DAYS.find((item) => item.dayOfWeek === dayOfWeek)?.label ?? `Dia ${dayOfWeek}`;
}

export function AdminHorarios({ barbers, availabilityByBarber }: AdminHorariosProps) {
  const [isPending, startTransition] = useTransition();
  const { pushToast } = useToast();
  const initialBarberId = barbers[0]?.id ?? "";
  const initialDays = useMemo(
    () => buildDraftRows(availabilityByBarber[initialBarberId]),
    [availabilityByBarber, initialBarberId],
  );
  const [selectedBarberId, setSelectedBarberId] = useState(initialBarberId);
  const [savedRows, setSavedRows] = useState<DayDraft[]>(() => cloneDays(initialDays));
  const [draftRows, setDraftRows] = useState<DayDraft[]>(() => cloneDays(initialDays));
  const [expandedDay, setExpandedDay] = useState<number | null>(null);
  const [copySourceDay, setCopySourceDay] = useState<number | null>(null);
  const [copyTargets, setCopyTargets] = useState<number[]>([]);

  const selectedBarber = useMemo(
    () => barbers.find((barber) => barber.id === selectedBarberId),
    [barbers, selectedBarberId],
  );
  const dirtyDays = useMemo(
    () => draftRows
      .filter((day) => {
        const saved = savedRows.find((item) => item.dayOfWeek === day.dayOfWeek);
        return !saved || !rangesMatch(day.ranges, saved.ranges);
      })
      .map((day) => day.dayOfWeek),
    [draftRows, savedRows],
  );
  const invalidDays = useMemo(
    () => draftRows.filter((day) => hasInvalidRanges(day.ranges)).map((day) => day.dayOfWeek),
    [draftRows],
  );
  const openDaysCount = draftRows.filter((day) => day.ranges.length > 0).length;
  const totalRangesCount = draftRows.reduce((total, day) => total + day.ranges.length, 0);
  const hasUnsavedChanges = dirtyDays.length > 0;

  useEffect(() => {
    if (!hasUnsavedChanges) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    const handleDocumentClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest("a[href]");
      if (!(link instanceof HTMLAnchorElement) || link.target === "_blank" || link.hasAttribute("download")) return;
      if (!window.confirm("Você possui alterações não salvas. Deseja sair e descartá-las?")) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("click", handleDocumentClick, true);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("click", handleDocumentClick, true);
    };
  }, [hasUnsavedChanges]);

  function replaceDayRanges(dayOfWeek: number, ranges: TimeRange[]) {
    setDraftRows((previous) =>
      previous.map((day) => day.dayOfWeek === dayOfWeek ? { ...day, ranges: cloneRanges(ranges) } : day),
    );
  }

  function addRange(dayOfWeek: number) {
    setDraftRows((previous) =>
      previous.map((day) =>
        day.dayOfWeek === dayOfWeek
          ? { ...day, ranges: [...day.ranges, { openTime: "09:00", closeTime: "10:00" }] }
          : day,
      ),
    );
  }

  function removeRange(dayOfWeek: number, rangeIndex: number) {
    setDraftRows((previous) =>
      previous.map((day) =>
        day.dayOfWeek === dayOfWeek
          ? { ...day, ranges: day.ranges.filter((_, index) => index !== rangeIndex) }
          : day,
      ),
    );
  }

  function updateRange(dayOfWeek: number, rangeIndex: number, patch: Partial<TimeRange>) {
    setDraftRows((previous) =>
      previous.map((day) =>
        day.dayOfWeek === dayOfWeek
          ? {
              ...day,
              ranges: day.ranges.map((range, index) => index === rangeIndex ? { ...range, ...patch } : range),
            }
          : day,
      ),
    );
  }

  function restoreTemplate(dayOfWeek: number) {
    replaceDayRanges(dayOfWeek, DEFAULT_DAY_RANGES[dayOfWeek] ?? []);
  }

  function toggleClosed(day: DayDraft) {
    if (day.ranges.length > 0) {
      if (window.confirm(`Fechar ${getDayLabel(day.dayOfWeek)}? A alteração só será aplicada após salvar.`)) {
        replaceDayRanges(day.dayOfWeek, []);
      }
      return;
    }
    restoreTemplate(day.dayOfWeek);
  }

  function changeBarber(nextBarberId: string) {
    if (hasUnsavedChanges && !window.confirm("Descartar as alterações pendentes e trocar de profissional?")) return;
    const next = buildDraftRows(availabilityByBarber[nextBarberId]);
    setSelectedBarberId(nextBarberId);
    setSavedRows(cloneDays(next));
    setDraftRows(cloneDays(next));
    setExpandedDay(null);
    setCopySourceDay(null);
    setCopyTargets([]);
  }

  function discardChanges() {
    if (!hasUnsavedChanges || window.confirm("Descartar todas as alterações ainda não salvas?")) {
      setDraftRows(cloneDays(savedRows));
      setCopySourceDay(null);
      setCopyTargets([]);
    }
  }

  function openCopyOptions(dayOfWeek: number) {
    setCopySourceDay((current) => current === dayOfWeek ? null : dayOfWeek);
    setCopyTargets([]);
  }

  function toggleCopyTarget(dayOfWeek: number) {
    setCopyTargets((current) =>
      current.includes(dayOfWeek) ? current.filter((item) => item !== dayOfWeek) : [...current, dayOfWeek],
    );
  }

  function applyCopy(sourceDayOfWeek: number, targetDays: number[]) {
    const source = draftRows.find((day) => day.dayOfWeek === sourceDayOfWeek);
    if (!source || targetDays.length === 0) return;
    setDraftRows((previous) =>
      previous.map((day) =>
        targetDays.includes(day.dayOfWeek) ? { ...day, ranges: cloneRanges(source.ranges) } : day,
      ),
    );
    setCopySourceDay(null);
    setCopyTargets([]);
    pushToast(`Configuração copiada para ${targetDays.length} dia${targetDays.length === 1 ? "" : "s"}.`);
  }

  function saveChanges() {
    if (invalidDays.length > 0) {
      setExpandedDay(invalidDays[0] ?? null);
      pushToast("Corrija as faixas inválidas antes de salvar.", "error");
      return;
    }
    const changes = draftRows.filter((day) => dirtyDays.includes(day.dayOfWeek));
    if (changes.length === 0) return;

    startTransition(async () => {
      const savedDayNumbers: number[] = [];
      try {
        for (const day of changes) {
          await replaceBarberDayAvailabilityAction({
            barberId: selectedBarberId,
            dayOfWeek: day.dayOfWeek,
            ranges: normalizeRanges(day.ranges),
          });
          savedDayNumbers.push(day.dayOfWeek);
        }
        setSavedRows(cloneDays(draftRows));
        pushToast(`${changes.length} dia${changes.length === 1 ? "" : "s"} atualizado${changes.length === 1 ? "" : "s"} com sucesso.`);
      } catch (error) {
        if (savedDayNumbers.length > 0) {
          setSavedRows((previous) =>
            previous.map((day) => {
              const savedDraft = draftRows.find((item) => item.dayOfWeek === day.dayOfWeek);
              return savedDayNumbers.includes(day.dayOfWeek) && savedDraft
                ? { ...day, ranges: cloneRanges(savedDraft.ranges) }
                : day;
            }),
          );
        }
        pushToast(error instanceof Error ? error.message : "Não foi possível salvar as alterações.", "error");
      }
    });
  }

  if (barbers.length === 0) {
    return (
      <section className="premium-card p-5 sm:p-6">
        <p className="eyebrow">Disponibilidade</p>
        <h2 className="mt-2 text-2xl font-semibold text-zinc-100">Grade semanal</h2>
        <p className="mt-2 text-sm text-copy-muted">Cadastre e ative um barbeiro antes de configurar os horários.</p>
      </section>
    );
  }

  return (
    <section className="space-y-5 pb-24">
      <header className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="eyebrow">Disponibilidade</p>
          <h2 className="mt-2 text-2xl font-semibold text-zinc-100 sm:text-3xl">Grade semanal</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-copy-muted">
            Organize os períodos de atendimento sem expor todos os campos ao mesmo tempo.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-white/[0.05] px-3 py-2 text-copy-subtle">
            <strong className="text-zinc-100">{openDaysCount}</strong> dias abertos
          </span>
          <span className="rounded-full bg-white/[0.05] px-3 py-2 text-copy-subtle">
            <strong className="text-zinc-100">{totalRangesCount}</strong> faixas
          </span>
          {hasUnsavedChanges ? (
            <span className="rounded-full bg-warning/10 px-3 py-2 font-semibold text-warning-soft">
              {dirtyDays.length} não salvo{dirtyDays.length === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>
      </header>

      <div className="premium-card p-4 sm:p-5">
        <div className="grid gap-4 lg:grid-cols-[minmax(220px,340px)_1fr] lg:items-end">
          <label>
            <span className="mb-2 block text-sm font-medium text-zinc-300">Profissional</span>
            <select
              value={selectedBarberId}
              onChange={(event) => changeBarber(event.target.value)}
              className="ui-control px-3 py-2.5"
            >
              {barbers.map((barber) => <option key={barber.id} value={barber.id}>{barber.name}</option>)}
            </select>
          </label>
          <div className="rounded-xl bg-brand/8 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-highlight/80">Editando agenda</p>
            <p className="mt-1 text-sm font-semibold text-brand-soft">{selectedBarber?.name}</p>
            <p className="mt-1 text-xs leading-5 text-brand-soft/65">
              A duração de cada reserva segue o serviço escolhido pelo cliente. Aqui você define apenas os períodos disponíveis.
            </p>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl bg-zinc-900/55 shadow-[0_16px_55px_rgba(0,0,0,0.18)]">
        <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-4 sm:px-5">
          <div>
            <h3 className="font-semibold text-zinc-100">Semana de atendimento</h3>
            <p className="mt-1 text-xs text-copy-muted">Abra somente o dia que deseja ajustar.</p>
          </div>
          {isPending ? (
            <span className="inline-flex items-center gap-2 text-xs font-medium text-brand-highlight" role="status">
              <span className="size-2 animate-pulse rounded-full bg-brand-highlight" />
              Salvando
            </span>
          ) : null}
        </div>

        <div className="divide-y divide-white/[0.06]">
          {draftRows.map((day) => {
            const dayLabel = getDayLabel(day.dayOfWeek);
            const isClosed = day.ranges.length === 0;
            const isDirty = dirtyDays.includes(day.dayOfWeek);
            const hasError = invalidDays.includes(day.dayOfWeek);
            const isExpanded = expandedDay === day.dayOfWeek;
            const editorId = `day-editor-${day.dayOfWeek}`;

            return (
              <article key={day.dayOfWeek} className={isExpanded ? "bg-white/[0.025]" : undefined}>
                <div className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(130px,0.8fr)_minmax(190px,1.4fr)_auto] sm:items-center sm:px-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="font-semibold text-zinc-100">{dayLabel}</h4>
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                      isClosed ? "bg-white/[0.05] text-copy-muted" : "bg-success/10 text-success-soft"
                    }`}>
                      {isClosed ? "Fechado" : "Aberto"}
                    </span>
                    {isDirty ? (
                      <span className="rounded-full bg-warning/10 px-2.5 py-1 text-[11px] font-semibold text-warning-soft">
                        Não salvo
                      </span>
                    ) : null}
                  </div>

                  <div>
                    <p className={isClosed ? "text-sm text-copy-muted" : "text-sm font-medium text-zinc-200"}>
                      {getRangeSummary(day.ranges)}
                    </p>
                    <p className="mt-0.5 text-xs text-copy-muted">
                      {day.ranges.length} faixa{day.ranges.length === 1 ? "" : "s"} de atendimento
                      {hasError ? <span className="ml-2 font-semibold text-danger-soft">Revisão necessária</span> : null}
                    </p>
                  </div>

                  <button
                    type="button"
                    aria-expanded={isExpanded}
                    aria-controls={editorId}
                    onClick={() => {
                      setExpandedDay(isExpanded ? null : day.dayOfWeek);
                      setCopySourceDay(null);
                    }}
                    className={`button-secondary w-full px-4 py-2 text-sm sm:w-auto ${isExpanded ? "border-brand-highlight/40" : ""}`}
                  >
                    {isExpanded ? "Recolher" : "Editar"}
                  </button>
                </div>

                {isExpanded ? (
                  <div id={editorId} className="border-t border-white/[0.06] bg-zinc-950/35 px-4 py-5 sm:px-5">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-sm font-semibold text-zinc-100">Períodos de {dayLabel.toLowerCase()}</p>
                        <p className="mt-1 text-xs leading-5 text-copy-muted">
                          Faixas podem representar expediente contínuo ou intervalos separados.
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => addRange(day.dayOfWeek)} className="button-secondary px-3 py-2 text-xs">
                          + Adicionar faixa
                        </button>
                        <button type="button" onClick={() => restoreTemplate(day.dayOfWeek)} className="button-ghost px-3 py-2 text-xs">
                          Restaurar padrão
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleClosed(day)}
                          className={isClosed ? "button-secondary px-3 py-2 text-xs" : "button-ghost px-3 py-2 text-xs text-danger-soft"}
                        >
                          {isClosed ? "Reabrir dia" : "Fechar dia"}
                        </button>
                      </div>
                    </div>

                    <div className="mt-4 space-y-2">
                      {day.ranges.map((range, rangeIndex) => (
                        <div
                          key={`${day.dayOfWeek}-${rangeIndex}`}
                          className="grid gap-3 rounded-xl bg-white/[0.035] p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
                        >
                          <label>
                            <span className="mb-1.5 block text-xs font-medium text-copy-muted">Início</span>
                            <input
                              type="time"
                              value={range.openTime}
                              onChange={(event) => updateRange(day.dayOfWeek, rangeIndex, { openTime: event.target.value })}
                              className="ui-control px-3 py-2"
                            />
                          </label>
                          <label>
                            <span className="mb-1.5 block text-xs font-medium text-copy-muted">Fim</span>
                            <input
                              type="time"
                              value={range.closeTime}
                              onChange={(event) => updateRange(day.dayOfWeek, rangeIndex, { closeTime: event.target.value })}
                              className="ui-control px-3 py-2"
                            />
                          </label>
                          <button
                            type="button"
                            aria-label={`Remover faixa ${rangeIndex + 1} de ${dayLabel}`}
                            onClick={() => removeRange(day.dayOfWeek, rangeIndex)}
                            className="button-ghost px-3 py-2 text-xs text-copy-muted hover:text-danger-soft"
                          >
                            Remover
                          </button>
                        </div>
                      ))}
                      {isClosed ? (
                        <div className="rounded-xl border border-dashed border-white/10 px-4 py-5 text-center">
                          <p className="text-sm font-medium text-zinc-300">Dia fechado para atendimento</p>
                          <p className="mt-1 text-xs text-copy-muted">Reabra o dia ou adicione uma faixa para voltar a disponibilizá-lo.</p>
                        </div>
                      ) : null}
                    </div>

                    {hasError ? (
                      <p className="ui-alert ui-alert-danger mt-3 text-xs" role="alert">
                        Corrija faixas sobrepostas ou horários em que o fim vem antes do início.
                      </p>
                    ) : null}

                    <div className="mt-4 border-t border-white/[0.06] pt-4">
                      <button
                        type="button"
                        aria-expanded={copySourceDay === day.dayOfWeek}
                        onClick={() => openCopyOptions(day.dayOfWeek)}
                        className="button-ghost px-3 py-2 text-xs"
                      >
                        Copiar configuração para outros dias
                      </button>

                      {copySourceDay === day.dayOfWeek ? (
                        <div className="mt-3 rounded-xl bg-white/[0.035] p-4">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <p className="text-sm font-semibold text-zinc-200">Aplicar configuração</p>
                              <p className="mt-1 text-xs text-copy-muted">Escolha os dias que receberão estas mesmas faixas.</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => applyCopy(day.dayOfWeek, [1, 2, 3, 4, 5].filter((item) => item !== day.dayOfWeek))}
                              className="button-secondary px-3 py-2 text-xs"
                            >
                              Aplicar de segunda a sexta
                            </button>
                          </div>
                          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                            {WEEK_DAYS.filter((item) => item.dayOfWeek !== day.dayOfWeek).map((item) => (
                              <label key={item.dayOfWeek} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg bg-zinc-950/45 px-3 text-sm text-zinc-300">
                                <input
                                  type="checkbox"
                                  checked={copyTargets.includes(item.dayOfWeek)}
                                  onChange={() => toggleCopyTarget(item.dayOfWeek)}
                                  className="size-4 accent-[var(--brand-strong)]"
                                />
                                {item.shortLabel}
                              </label>
                            ))}
                          </div>
                          <div className="mt-3 flex justify-end">
                            <button
                              type="button"
                              disabled={copyTargets.length === 0}
                              onClick={() => applyCopy(day.dayOfWeek, copyTargets)}
                              className="button-primary px-4 py-2 text-xs"
                            >
                              Aplicar aos dias selecionados
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </div>

      <div className={`fixed inset-x-3 bottom-3 z-30 mx-auto max-w-3xl transition ${
        hasUnsavedChanges ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-4 opacity-0"
      }`}>
        <div className="flex flex-col gap-3 rounded-2xl border border-brand-highlight/25 bg-zinc-950/95 p-3 shadow-2xl backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between sm:px-4">
          <div>
            <p className="text-sm font-semibold text-zinc-100">
              {dirtyDays.length} dia{dirtyDays.length === 1 ? "" : "s"} com alterações
            </p>
            <p className="mt-0.5 text-xs text-copy-muted">Revise e salve antes de sair desta página.</p>
          </div>
          <div className="flex gap-2">
            <button type="button" disabled={isPending} onClick={discardChanges} className="button-ghost flex-1 px-4 py-2 text-sm sm:flex-none">
              Descartar
            </button>
            <button
              type="button"
              disabled={isPending || invalidDays.length > 0}
              onClick={saveChanges}
              className="button-primary flex-1 px-5 py-2 text-sm sm:flex-none"
            >
              {isPending ? "Salvando..." : "Salvar alterações"}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
