"use client";

import { useMemo, useState } from "react";

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

function toIsoDate(year: number, monthZeroBased: number, day: number): string {
  return `${year}-${pad2(monthZeroBased + 1)}-${pad2(day)}`;
}

function parseIsoDate(iso: string): { year: number; month: number; day: number } {
  const [year, month, day] = iso.split("-").map(Number);
  return { year, month: month - 1, day };
}

function monthLabel(year: number, monthZeroBased: number): string {
  return new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(
    new Date(year, monthZeroBased, 1),
  );
}

function addMonths(year: number, monthZeroBased: number, amount: number): { year: number; month: number } {
  const date = new Date(year, monthZeroBased + amount, 1);
  return { year: date.getFullYear(), month: date.getMonth() };
}

function isToday(iso: string): boolean {
  const today = new Date();
  return iso === toIsoDate(today.getFullYear(), today.getMonth(), today.getDate());
}

export function DateCalendar({
  minDate,
  selectedDate,
  onSelect,
  maxMonthsForward = 5,
  density = "comfortable",
}: {
  minDate: string;
  selectedDate?: string;
  onSelect: (isoDate: string) => void;
  maxMonthsForward?: number;
  density?: "comfortable" | "compact";
}) {
  const isCompact = density === "compact";
  const min = parseIsoDate(minDate);
  const minMonthKey = `${min.year}-${min.month}`;
  const maxMonth = addMonths(min.year, min.month, maxMonthsForward);
  const maxMonthKey = `${maxMonth.year}-${maxMonth.month}`;

  const initialMonth = selectedDate ? parseIsoDate(selectedDate) : min;
  const [view, setView] = useState({ year: initialMonth.year, month: initialMonth.month });

  const canGoPrev = `${view.year}-${view.month}` > minMonthKey;
  const canGoNext = `${view.year}-${view.month}` < maxMonthKey;

  const cells = useMemo(() => {
    const firstDay = new Date(view.year, view.month, 1);
    const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();
    const leadingEmpty = (firstDay.getDay() + 6) % 7;
    const total = Math.ceil((leadingEmpty + daysInMonth) / 7) * 7;
    const result: Array<{ key: string; label?: number; iso?: string }> = [];

    for (let index = 0; index < total; index += 1) {
      const day = index - leadingEmpty + 1;
      if (day < 1 || day > daysInMonth) {
        result.push({ key: `empty-${index}` });
      } else {
        result.push({
          key: `${view.year}-${view.month}-${day}`,
          label: day,
          iso: toIsoDate(view.year, view.month, day),
        });
      }
    }

    return result;
  }, [view.month, view.year]);

  return (
    <div
      className={`mt-2 rounded-xl border border-zinc-800 bg-zinc-950/60 shadow-inner shadow-black/20 ${
        isCompact ? "p-3" : "p-3 sm:p-4"
      }`}
    >
      <div className={`${isCompact ? "mb-3" : "mb-4"} flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between`}>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              const today = new Date();
              const todayIso = toIsoDate(today.getFullYear(), today.getMonth(), today.getDate());
              if (todayIso >= minDate) {
                onSelect(todayIso);
              }
              setView({ year: today.getFullYear(), month: today.getMonth() });
            }}
            className={`rounded-full border border-zinc-700 text-xs font-semibold text-zinc-100 transition hover:border-cyan-300 ${
              isCompact ? "px-2.5 py-1" : "px-3 py-1.5"
            }`}
          >
            Hoje
          </button>
          <div className={`flex items-center rounded-full border border-zinc-800 bg-zinc-900 ${isCompact ? "p-0.5" : "p-1"}`}>
            <button
              type="button"
              onClick={() => canGoPrev && setView((prev) => addMonths(prev.year, prev.month, -1))}
              disabled={!canGoPrev}
              aria-label="Mes anterior"
              className={`grid place-items-center rounded-full leading-none text-zinc-200 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 ${
                isCompact ? "h-7 w-7 text-base" : "h-8 w-8 text-lg"
              }`}
            >
              {"<"}
            </button>
            <button
              type="button"
              onClick={() => canGoNext && setView((prev) => addMonths(prev.year, prev.month, 1))}
              disabled={!canGoNext}
              aria-label="Proximo mes"
              className={`grid place-items-center rounded-full leading-none text-zinc-200 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 ${
                isCompact ? "h-7 w-7 text-base" : "h-8 w-8 text-lg"
              }`}
            >
              {">"}
            </button>
          </div>
        </div>
        <p className={`font-semibold capitalize text-zinc-100 ${isCompact ? "text-sm" : "text-sm sm:text-base"}`}>
          {monthLabel(view.year, view.month)}
        </p>
      </div>

      <div
        className={`grid grid-cols-7 border-b border-zinc-800 text-center font-semibold uppercase tracking-wide text-zinc-500 ${
          isCompact ? "pb-1.5 text-[10px]" : "pb-2 text-[11px]"
        }`}
      >
        {["Seg", "Ter", "Qua", "Qui", "Sex", "Sab", "Dom"].map((day) => (
          <div key={day} className="py-1">
            {day}
          </div>
        ))}
      </div>

      <div className={`grid grid-cols-7 ${isCompact ? "mt-1.5 gap-1" : "mt-2 gap-1 sm:gap-2"}`}>
        {cells.map((cell) => {
          if (!cell.iso || !cell.label) {
            return <div key={cell.key} className={isCompact ? "h-9 rounded-full" : "aspect-square rounded-full"} />;
          }

          const disabled = cell.iso < minDate;
          const selected = selectedDate === cell.iso;
          const today = isToday(cell.iso);

          return (
            <button
              type="button"
              key={cell.key}
              disabled={disabled}
              onClick={() => onSelect(cell.iso!)}
              aria-pressed={selected}
              className={`${isCompact ? "h-9 min-w-0" : "aspect-square"} rounded-full border font-semibold transition ${
                isCompact ? "text-xs" : "text-sm"
              } ${
                selected
                  ? "border-cyan-300 bg-cyan-400 text-zinc-950 shadow-lg shadow-cyan-950/30"
                  : disabled
                    ? "border-transparent bg-transparent text-zinc-700"
                    : today
                      ? "border-cyan-400/70 bg-zinc-900 text-cyan-100 hover:bg-zinc-800"
                      : "border-transparent bg-transparent text-zinc-200 hover:bg-zinc-800"
              }`}
            >
              {cell.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
