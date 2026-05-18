"use client";

import { useMemo, useState, useTransition } from "react";
import { createBlockedSlotAction, deleteBlockedSlotAction } from "@/lib/actions/booking-actions";
import { useToast } from "@/components/ui/toast";
import { BUSINESS_CONFIG } from "@/lib/config";
import { getLocalDateInput, getTimeLabelInTimeZone } from "@/lib/utils";
import { Barber, BlockedSlot } from "@/types/domain";

type AdminBloqueiosProps = {
  blockedSlots: BlockedSlot[];
  barbers: Barber[];
};

function formatDateTime(iso: string) {
  const date = getLocalDateInput(iso, BUSINESS_CONFIG.timezone).split("-").reverse().join("/");
  const time = getTimeLabelInTimeZone(iso, BUSINESS_CONFIG.timezone);
  return `${date} ${time}`;
}

function formatDuration(startIso: string, endIso: string) {
  const diffMinutes = Math.max(0, Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000));
  const hours = Math.floor(diffMinutes / 60);
  const minutes = diffMinutes % 60;
  if (hours === 0) {
    return `${minutes} min`;
  }
  if (minutes === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${minutes}min`;
}

export function AdminBloqueios({ blockedSlots, barbers }: AdminBloqueiosProps) {
  const [isPending, startTransition] = useTransition();
  const { pushToast } = useToast();

  const [blockForm, setBlockForm] = useState({
    barberId: "",
    dateTimeStart: "",
    dateTimeEnd: "",
    reason: "",
  });

  const activeBlockedSlots = useMemo(
    () => {
      const now = new Date();
      return blockedSlots
        .filter((slot) => new Date(slot.dateTimeEnd).getTime() >= now.getTime())
        .sort((a, b) => new Date(a.dateTimeStart).getTime() - new Date(b.dateTimeStart).getTime());
    },
    [blockedSlots],
  );
  const expiredBlockedSlots = blockedSlots.length - activeBlockedSlots.length;
  const globalBlocks = activeBlockedSlots.filter((slot) => !slot.barberId).length;
  const selectedBarber = barbers.find((barber) => barber.id === blockForm.barberId);

  function validateForm() {
    if (!blockForm.dateTimeStart || !blockForm.dateTimeEnd) {
      pushToast("Informe inicio e fim do bloqueio", "error");
      return false;
    }

    const start = new Date(blockForm.dateTimeStart);
    const end = new Date(blockForm.dateTimeEnd);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      pushToast("Data ou horario invalido", "error");
      return false;
    }
    if (start >= end) {
      pushToast("O fim precisa ser depois do inicio", "error");
      return false;
    }
    if (!blockForm.reason.trim()) {
      pushToast("Informe o motivo do bloqueio", "error");
      return false;
    }

    return true;
  }

  function submitBlock() {
    if (!validateForm()) {
      return;
    }

    startTransition(async () => {
      try {
        await createBlockedSlotAction({
          barberId: blockForm.barberId || undefined,
          dateTimeStart: new Date(blockForm.dateTimeStart).toISOString(),
          dateTimeEnd: new Date(blockForm.dateTimeEnd).toISOString(),
          reason: blockForm.reason.trim(),
        });
        setBlockForm({ barberId: "", dateTimeStart: "", dateTimeEnd: "", reason: "" });
        pushToast("Bloqueio criado", "success");
        window.location.reload();
      } catch (error) {
        pushToast(error instanceof Error ? error.message : "Erro ao bloquear", "error");
      }
    });
  }

  function removeBlock(blockedSlot: BlockedSlot) {
    const confirmed = window.confirm(`Remover o bloqueio "${blockedSlot.reason}"?`);
    if (!confirmed) {
      return;
    }

    startTransition(async () => {
      try {
        await deleteBlockedSlotAction({ blockedSlotId: blockedSlot.id });
        pushToast("Bloqueio removido", "success");
        window.location.reload();
      } catch (error) {
        pushToast(error instanceof Error ? error.message : "Erro ao remover bloqueio", "error");
      }
    });
  }

  function getBarberName(barberId?: string) {
    if (!barberId) {
      return "Todos os barbeiros";
    }
    return barbers.find((barber) => barber.id === barberId)?.name ?? "Barbeiro removido";
  }

  return (
    <section className="space-y-6">
      <header className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300">Agenda</p>
            <h2 className="mt-2 text-2xl font-bold text-zinc-100 sm:text-3xl">Bloqueios</h2>
            <p className="mt-2 max-w-2xl text-sm text-zinc-400">
              Bloqueie intervalos de atendimento para almoco, folgas, manutencoes ou compromissos externos.
            </p>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-4 py-3">
            <p className="text-xs text-zinc-500">Escopo selecionado</p>
            <p className="mt-1 text-sm font-semibold text-zinc-100">
              {selectedBarber?.name ?? "Todos os barbeiros"}
            </p>
          </div>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <article className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Ativos</p>
          <p className="mt-3 text-3xl font-black text-zinc-100">{activeBlockedSlots.length}</p>
          <p className="mt-1 text-sm text-zinc-400">intervalos bloqueados</p>
        </article>
        <article className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Globais</p>
          <p className="mt-3 text-3xl font-black text-cyan-100">{globalBlocks}</p>
          <p className="mt-1 text-sm text-zinc-400">afetam todos os barbeiros</p>
        </article>
        <article className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Encerrados</p>
          <p className="mt-3 text-3xl font-black text-zinc-300">{expiredBlockedSlots}</p>
          <p className="mt-1 text-sm text-zinc-400">historico ja vencido</p>
        </article>
      </div>

      <div className="grid gap-6 xl:grid-cols-[390px_1fr]">
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5">
          <h3 className="text-lg font-semibold text-zinc-100">Novo bloqueio</h3>
          <p className="mt-1 text-sm text-zinc-500">Defina o periodo que nao deve aparecer para agendamento.</p>

          <div className="mt-5 space-y-4">
            <label className="block">
              <span className="text-sm font-medium text-zinc-300">Barbeiro</span>
              <select
                value={blockForm.barberId}
                onChange={(event) => setBlockForm((prev) => ({ ...prev, barberId: event.target.value }))}
                className="mt-2 h-11 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-zinc-100 outline-none transition focus:border-cyan-300"
              >
                <option value="">Todos os barbeiros</option>
                {barbers.map((barber) => (
                  <option key={barber.id} value={barber.id}>
                    {barber.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <label className="block">
                <span className="text-sm font-medium text-zinc-300">Inicio</span>
                <input
                  type="datetime-local"
                  value={blockForm.dateTimeStart}
                  onChange={(event) => setBlockForm((prev) => ({ ...prev, dateTimeStart: event.target.value }))}
                  className="mt-2 h-11 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-zinc-100 outline-none transition focus:border-cyan-300"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-zinc-300">Fim</span>
                <input
                  type="datetime-local"
                  value={blockForm.dateTimeEnd}
                  onChange={(event) => setBlockForm((prev) => ({ ...prev, dateTimeEnd: event.target.value }))}
                  className="mt-2 h-11 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-zinc-100 outline-none transition focus:border-cyan-300"
                />
              </label>
            </div>

            <label className="block">
              <span className="text-sm font-medium text-zinc-300">Motivo</span>
              <input
                type="text"
                value={blockForm.reason}
                onChange={(event) => setBlockForm((prev) => ({ ...prev, reason: event.target.value }))}
                placeholder="Ex: Almoco, viagem, manutencao"
                className="mt-2 h-11 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-zinc-100 outline-none transition focus:border-cyan-300"
              />
            </label>

            {blockForm.dateTimeStart && blockForm.dateTimeEnd ? (
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-3 text-sm text-zinc-400">
                Duracao prevista:{" "}
                <span className="font-semibold text-zinc-100">
                  {formatDuration(new Date(blockForm.dateTimeStart).toISOString(), new Date(blockForm.dateTimeEnd).toISOString())}
                </span>
              </div>
            ) : null}

            <button
              type="button"
              disabled={isPending}
              onClick={submitBlock}
              className="h-11 w-full rounded-lg bg-cyan-400 px-4 text-sm font-bold text-zinc-950 transition hover:bg-cyan-300 disabled:opacity-70"
            >
              Salvar bloqueio
            </button>
          </div>
        </section>

        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-lg font-semibold text-zinc-100">Bloqueios ativos</h3>
              <p className="mt-1 text-sm text-zinc-500">Intervalos que ainda impedem novos agendamentos.</p>
            </div>
            <span className="w-fit rounded-full border border-zinc-700 px-3 py-1 text-xs font-semibold text-zinc-300">
              {activeBlockedSlots.length} ativos
            </span>
          </div>

          <div className="mt-5 grid gap-3">
            {activeBlockedSlots.map((blocked) => (
              <article
                key={blocked.id}
                className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4 transition hover:border-zinc-700"
              >
                <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-center">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-zinc-100">{blocked.reason}</p>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                          blocked.barberId
                            ? "border-cyan-400/30 bg-cyan-400/10 text-cyan-100"
                            : "border-amber-400/40 bg-amber-400/10 text-amber-100"
                        }`}
                      >
                        {blocked.barberId ? "Individual" : "Global"}
                      </span>
                    </div>
                    <div className="mt-3 grid gap-2 text-sm lg:grid-cols-3">
                      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2">
                        <p className="text-xs text-zinc-500">Inicio</p>
                        <p className="mt-1 font-semibold text-zinc-100">{formatDateTime(blocked.dateTimeStart)}</p>
                      </div>
                      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2">
                        <p className="text-xs text-zinc-500">Fim</p>
                        <p className="mt-1 font-semibold text-zinc-100">{formatDateTime(blocked.dateTimeEnd)}</p>
                      </div>
                      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2">
                        <p className="text-xs text-zinc-500">Escopo</p>
                        <p className="mt-1 font-semibold text-cyan-100">{getBarberName(blocked.barberId)}</p>
                      </div>
                    </div>
                    <p className="mt-3 text-xs text-zinc-500">Duracao: {formatDuration(blocked.dateTimeStart, blocked.dateTimeEnd)}</p>
                  </div>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => removeBlock(blocked)}
                    className="rounded-lg border border-red-500/60 px-3 py-2 text-sm font-semibold text-red-200 transition hover:bg-red-500/10 disabled:opacity-70"
                  >
                    Remover
                  </button>
                </div>
              </article>
            ))}

            {activeBlockedSlots.length === 0 ? (
              <div className="rounded-xl border border-dashed border-zinc-700 bg-zinc-950/40 p-6 text-center text-sm text-zinc-500">
                Sem bloqueios ativos.
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </section>
  );
}
