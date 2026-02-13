"use client";

import { AvailableSlot } from "@/types/scheduler";

export function AvailableSlots({
  slots,
  selectedStart,
  onSelect,
  loading,
}: {
  slots: AvailableSlot[];
  selectedStart?: string;
  onSelect: (slot: AvailableSlot) => void;
  loading: boolean;
}) {
  if (loading) {
    return <p className="mt-4 text-sm text-zinc-400">Carregando horários...</p>;
  }

  if (slots.length === 0) {
    return <p className="mt-4 text-sm text-amber-200">Sem horários disponíveis para essa data.</p>;
  }

  return (
    <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4">
      {slots.map((slot) => {
        const selected = slot.start === selectedStart;
        return (
          <button
            type="button"
            key={slot.start}
            onClick={() => onSelect(slot)}
            className={`rounded-lg border px-3 py-2 text-sm font-semibold transition ${selected
                ? "border-cyan-300 bg-cyan-400 text-zinc-950"
                : "border-zinc-700 bg-zinc-900 text-zinc-200 hover:border-cyan-300"
              }`}
          >
            {slot.label}
          </button>
        );
      })}
    </div>
  );
}

