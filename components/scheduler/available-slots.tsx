"use client";

import { AvailableSlot } from "@/types/scheduler";

type SlotGroup = {
  title: string;
  slots: AvailableSlot[];
};

function getSlotHour(slot: AvailableSlot): number {
  return Number(slot.label.split(":")[0] ?? 0);
}

function groupSlots(slots: AvailableSlot[]): SlotGroup[] {
  const groups: SlotGroup[] = [
    { title: "Manha", slots: [] },
    { title: "Tarde", slots: [] },
    { title: "Noite", slots: [] },
  ];

  for (const slot of slots) {
    const hour = getSlotHour(slot);
    if (hour < 12) {
      groups[0].slots.push(slot);
    } else if (hour < 18) {
      groups[1].slots.push(slot);
    } else {
      groups[2].slots.push(slot);
    }
  }

  return groups.filter((group) => group.slots.length > 0);
}

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
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
        <div className="h-4 w-36 animate-pulse rounded bg-zinc-800" />
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[1, 2, 3, 4].map((item) => (
            <div key={item} className="h-10 animate-pulse rounded-lg bg-zinc-900" />
          ))}
        </div>
      </div>
    );
  }

  if (slots.length === 0) {
    return (
      <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-4 text-sm text-amber-100">
        Nao ha horarios disponiveis para esse dia.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/60">
      <div className="flex items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-zinc-100">Horarios disponiveis</p>
          <p className="text-xs text-zinc-500">Selecione um horario para continuar.</p>
        </div>
        <span className="rounded-full border border-zinc-700 px-2.5 py-1 text-xs font-semibold text-zinc-300">
          {slots.length}
        </span>
      </div>

      <div className="divide-y divide-zinc-800">
        {groupSlots(slots).map((group) => (
          <section key={group.title} className="grid gap-3 px-4 py-4 sm:grid-cols-[72px_1fr]">
            <p className="pt-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">{group.title}</p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5">
              {group.slots.map((slot) => {
                const selected = slot.start === selectedStart;
                return (
                  <button
                    type="button"
                    key={slot.start}
                    onClick={() => onSelect(slot)}
                    className={`h-10 rounded-lg border px-3 text-sm font-semibold transition ${
                      selected
                        ? "border-cyan-300 bg-cyan-400 text-zinc-950 shadow-lg shadow-cyan-950/30"
                        : "border-zinc-700 bg-zinc-900/80 text-zinc-200 hover:border-cyan-300 hover:bg-zinc-800"
                    }`}
                  >
                    {slot.label}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
