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
  return new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(new Date(year, monthZeroBased, 1));
}

function addMonths(year: number, monthZeroBased: number, amount: number): { year: number; month: number } {
  const date = new Date(year, monthZeroBased + amount, 1);
  return { year: date.getFullYear(), month: date.getMonth() };
}

export function DateCalendar({
  minDate,
  selectedDate,
  onSelect,
}: {
  minDate: string;
  selectedDate?: string;
  onSelect: (isoDate: string) => void;
}) {
  const min = parseIsoDate(minDate);
  const minMonthKey = `${min.year}-${min.month}`;
  const maxMonth = addMonths(min.year, min.month, 5);
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
    <div className="mt-2 rounded-xl border border-zinc-800 bg-zinc-950/60 p-3 sm:p-4">
      <div className="mb-3 grid grid-cols-[auto_1fr_auto] items-center gap-2">
        <button
          type="button"
          onClick={() => canGoPrev && setView((prev) => addMonths(prev.year, prev.month, -1))}
          disabled={!canGoPrev}
          className="rounded-md border border-zinc-700 px-2 py-1.5 text-[11px] text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40 sm:px-3 sm:text-xs"
        >
          Mes anterior
        </button>
        <p className="text-center text-xs font-semibold capitalize text-zinc-100 sm:text-sm">{monthLabel(view.year, view.month)}</p>
        <button
          type="button"
          onClick={() => canGoNext && setView((prev) => addMonths(prev.year, prev.month, 1))}
          disabled={!canGoNext}
          className="rounded-md border border-zinc-700 px-2 py-1.5 text-[11px] text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40 sm:px-3 sm:text-xs"
        >
          Proximo mes
        </button>
      </div>

      <div className="grid grid-cols-7 gap-2 text-center text-xs text-zinc-400">
        {["Seg", "Ter", "Qua", "Qui", "Sex", "Sab", "Dom"].map((day) => (
          <div key={day} className="py-1">
            {day}
          </div>
        ))}
      </div>

      <div className="mt-1 grid grid-cols-7 gap-2">
        {cells.map((cell) => {
          if (!cell.iso || !cell.label) {
            return <div key={cell.key} className="h-10 rounded-md" />;
          }

          const disabled = cell.iso < minDate;
          const selected = selectedDate === cell.iso;

          return (
            <button
              type="button"
              key={cell.key}
              disabled={disabled}
              onClick={() => onSelect(cell.iso!)}
              className={`h-10 rounded-md border text-sm font-semibold transition ${
                selected
                  ? "border-cyan-300 bg-cyan-400 text-zinc-950"
                  : disabled
                    ? "border-zinc-800 bg-zinc-900 text-zinc-600"
                    : "border-zinc-700 bg-zinc-900 text-zinc-200 hover:border-cyan-300"
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
