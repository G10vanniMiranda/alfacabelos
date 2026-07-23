"use client";

import { useMemo, useState, useTransition } from "react";
import { createBlockedSlotAction, deleteBlockedSlotAction } from "@/lib/actions/booking-actions";
import { useToast } from "@/components/ui/toast";
import { BUSINESS_CONFIG } from "@/lib/config";
import { getLocalDateInput, getTimeLabelInTimeZone, zonedDateTimeToUtcIso } from "@/lib/utils";
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
      pushToast("Informe início e fim do bloqueio", "error");
      return false;
    }

    const start = new Date(blockForm.dateTimeStart);
    const end = new Date(blockForm.dateTimeEnd);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      pushToast("Data ou horário inválido", "error");
      return false;
    }
    if (start >= end) {
      pushToast("O fim precisa ser depois do início", "error");
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
        const [startDate, startTime] = blockForm.dateTimeStart.split("T");
        const [endDate, endTime] = blockForm.dateTimeEnd.split("T");
        await createBlockedSlotAction({
          barberId: blockForm.barberId || undefined,
          dateTimeStart: zonedDateTimeToUtcIso(startDate, `${startTime}:00`, BUSINESS_CONFIG.timezone),
          dateTimeEnd: zonedDateTimeToUtcIso(endDate, `${endTime}:00`, BUSINESS_CONFIG.timezone),
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
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-brand-highlight">Agenda</p>
            <h2 className="mt-2 text-2xl font-bold text-zinc-100 sm:text-3xl">Bloqueios</h2>
            <p className="mt-2 max-w-2xl text-sm text-zinc-400">
              Bloqueie intervalos de atendimento para almoço, folgas, manutenções ou compromissos externos.
            </p>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-4 py-3">
            <p className="text-xs text-copy-muted">Escopo selecionado</p>
            <p className="mt-1 text-sm font-semibold text-zinc-100">
              {selectedBarber?.name ?? "Todos os barbeiros"}
            </p>
          </div>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <article className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-copy-muted">Ativos</p>
          <p className="mt-3 text-3xl font-black text-zinc-100">{activeBlockedSlots.length}</p>
          <p className="mt-1 text-sm text-zinc-400">intervalos bloqueados</p>
        </article>
        <article className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-copy-muted">Globais</p>
          <p className="mt-3 text-3xl font-black text-brand-soft">{globalBlocks}</p>
          <p className="mt-1 text-sm text-zinc-400">afetam todos os barbeiros</p>
        </article>
        <article className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-copy-muted">Encerrados</p>
          <p className="mt-3 text-3xl font-black text-zinc-300">{expiredBlockedSlots}</p>
          <p className="mt-1 text-sm text-zinc-400">Histórico já vencido</p>
        </article>
      </div>

      <div className="grid gap-6 xl:grid-cols-[390px_1fr]">
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5">
          <h3 className="text-lg font-semibold text-zinc-100">Novo bloqueio</h3>
          <p className="mt-1 text-sm text-copy-muted">Defina o período que não deve aparecer para agendamento.</p>

          <div className="mt-5 space-y-4">
            <label className="block">
              <span className="text-sm font-medium text-zinc-300">Barbeiro</span>
              <select
                value={blockForm.barberId}
                onChange={(event) => setBlockForm((prev) => ({ ...prev, barberId: event.target.value }))}
                className="ui-control mt-2 h-11 w-full px-3"
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
                <span className="text-sm font-medium text-zinc-300">Início</span>
                <input
                  type="datetime-local"
                  value={blockForm.dateTimeStart}
                  onChange={(event) => setBlockForm((prev) => ({ ...prev, dateTimeStart: event.target.value }))}
                  className="ui-control mt-2 h-11 w-full px-3"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-zinc-300">Fim</span>
                <input
                  type="datetime-local"
                  value={blockForm.dateTimeEnd}
                  onChange={(event) => setBlockForm((prev) => ({ ...prev, dateTimeEnd: event.target.value }))}
                  className="ui-control mt-2 h-11 w-full px-3"
                />
              </label>
            </div>

            <label className="block">
              <span className="text-sm font-medium text-zinc-300">Motivo</span>
              <input
                type="text"
                value={blockForm.reason}
                onChange={(event) => setBlockForm((prev) => ({ ...prev, reason: event.target.value }))}
                placeholder="Ex.: almoço, viagem, manutenção"
                className="ui-control mt-2 h-11 w-full px-3"
              />
            </label>

            {blockForm.dateTimeStart && blockForm.dateTimeEnd ? (
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-3 text-sm text-zinc-400">
                Duração prevista:{" "}
                <span className="font-semibold text-zinc-100">
                  {formatDuration(new Date(blockForm.dateTimeStart).toISOString(), new Date(blockForm.dateTimeEnd).toISOString())}
                </span>
              </div>
            ) : null}

            <button
              type="button"
              disabled={isPending}
              onClick={submitBlock}
              className="button-primary h-11 w-full px-4 disabled:opacity-70"
            >
              Salvar bloqueio
            </button>
          </div>
        </section>

        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-lg font-semibold text-zinc-100">Bloqueios ativos</h3>
              <p className="mt-1 text-sm text-copy-muted">Intervalos que ainda impedem novos agendamentos.</p>
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
                            ? "border-brand/30 bg-brand/10 text-brand-soft"
                            : "border-warning/40 bg-warning/10 text-warning-soft"
                        }`}
                      >
                        {blocked.barberId ? "Individual" : "Global"}
                      </span>
                    </div>
                    <div className="mt-3 grid gap-2 text-sm lg:grid-cols-3">
                      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2">
                        <p className="text-xs text-copy-muted">Início</p>
                        <p className="mt-1 font-semibold text-zinc-100">{formatDateTime(blocked.dateTimeStart)}</p>
                      </div>
                      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2">
                        <p className="text-xs text-copy-muted">Fim</p>
                        <p className="mt-1 font-semibold text-zinc-100">{formatDateTime(blocked.dateTimeEnd)}</p>
                      </div>
                      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2">
                        <p className="text-xs text-copy-muted">Escopo</p>
                        <p className="mt-1 font-semibold text-brand-soft">{getBarberName(blocked.barberId)}</p>
                      </div>
                    </div>
                    <p className="mt-3 text-xs text-copy-muted">Duração: {formatDuration(blocked.dateTimeStart, blocked.dateTimeEnd)}</p>
                  </div>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => removeBlock(blocked)}
                    className="button-danger px-3 py-2"
                  >
                    Remover
                  </button>
                </div>
              </article>
            ))}

            {activeBlockedSlots.length === 0 ? (
              <div className="rounded-xl border border-dashed border-zinc-700 bg-zinc-950/40 p-6 text-center text-sm text-copy-muted">
                Sem bloqueios ativos.
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </section>
  );
}
