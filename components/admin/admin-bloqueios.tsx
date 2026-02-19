"use client";

import { useState, useTransition } from "react";
import { createBlockedSlotAction, deleteBlockedSlotAction } from "@/lib/actions/booking-actions";
import { useToast } from "@/components/ui/toast";
import { Barber, BlockedSlot } from "@/types/domain";

type AdminBloqueiosProps = {
  blockedSlots: BlockedSlot[];
  barbers: Barber[];
};

export function AdminBloqueios({ blockedSlots, barbers }: AdminBloqueiosProps) {
  const [isPending, startTransition] = useTransition();
  const { pushToast } = useToast();

  const [blockForm, setBlockForm] = useState({
    barberId: "",
    dateTimeStart: "",
    dateTimeEnd: "",
    reason: "",
  });

  function submitBlock() {
    startTransition(async () => {
      try {
        await createBlockedSlotAction({
          barberId: blockForm.barberId || undefined,
          dateTimeStart: new Date(blockForm.dateTimeStart).toISOString(),
          dateTimeEnd: new Date(blockForm.dateTimeEnd).toISOString(),
          reason: blockForm.reason,
        });
        pushToast("Bloqueio criado", "success");
        window.location.reload();
      } catch (error) {
        pushToast(error instanceof Error ? error.message : "Erro ao bloquear", "error");
      }
    });
  }

  function removeBlock(blockedSlotId: string) {
    startTransition(async () => {
      try {
        await deleteBlockedSlotAction({ blockedSlotId });
        pushToast("Bloqueio removido", "success");
        window.location.reload();
      } catch (error) {
        pushToast(error instanceof Error ? error.message : "Erro ao remover bloqueio", "error");
      }
    });
  }

  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 px-5 py-4">
        <h2 className="text-2xl font-semibold text-zinc-100">Bloqueios</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Controle períodos indisponíveis para evitar novos agendamentos nesses horários.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
          <h3 className="text-xl font-semibold text-zinc-100">Novo bloqueio</h3>
          <div className="mt-4 space-y-3">
            <select
              value={blockForm.barberId}
              onChange={(event) => setBlockForm((prev) => ({ ...prev, barberId: event.target.value }))}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
            >
              <option value="">Todos os barbeiros</option>
              {barbers.map((barber) => (
                <option key={barber.id} value={barber.id}>
                  {barber.name}
                </option>
              ))}
            </select>
            <input
              type="datetime-local"
              value={blockForm.dateTimeStart}
              onChange={(event) => setBlockForm((prev) => ({ ...prev, dateTimeStart: event.target.value }))}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
            />
            <input
              type="datetime-local"
              value={blockForm.dateTimeEnd}
              onChange={(event) => setBlockForm((prev) => ({ ...prev, dateTimeEnd: event.target.value }))}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
            />
            <input
              type="text"
              value={blockForm.reason}
              onChange={(event) => setBlockForm((prev) => ({ ...prev, reason: event.target.value }))}
              placeholder="Motivo"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
            />
            <button
              type="button"
              disabled={isPending}
              onClick={submitBlock}
              className="rounded-lg bg-cyan-400 px-4 py-2 text-sm font-bold text-zinc-950 disabled:opacity-70"
            >
              Salvar bloqueio
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
          <h3 className="text-xl font-semibold text-zinc-100">Bloqueios ativos</h3>
          <ul className="mt-4 space-y-2 text-sm">
            {blockedSlots.map((blocked) => (
              <li key={blocked.id} className="rounded-lg border border-zinc-700 bg-zinc-950/70 p-3 text-zinc-300">
                <p>
                  {new Date(blocked.dateTimeStart).toLocaleString("pt-BR")} -{" "}
                  {new Date(blocked.dateTimeEnd).toLocaleString("pt-BR")}
                </p>
                <p className="text-zinc-400">{blocked.reason}</p>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => removeBlock(blocked.id)}
                  className="mt-2 rounded border border-red-400/60 px-2 py-1 text-xs text-red-200"
                >
                  Remover
                </button>
              </li>
            ))}
            {blockedSlots.length === 0 && <li className="text-zinc-500">Sem bloqueios cadastrados.</li>}
          </ul>
        </div>
      </div>
    </section>
  );
}
