"use client";

import { useCallback, useEffect, useState } from "react";
import { BUSINESS_CONFIG } from "@/lib/config";
import { formatDateTimeInTimeZone } from "@/lib/utils";
import type { OwnerAlert } from "@/lib/notifications/owner-alerts";

const POLL_MS = 60_000;
const SEEN_KEY = "alfa.admin.alerts.seenAt";

const EVENT_LABELS: Record<OwnerAlert["event"], string> = {
  BOOKING_CREATED_BY_CLIENT: "Novo agendamento (cliente)",
  BOOKING_CREATED_BY_STAFF: "Agendamento criado pela equipe",
  BOOKING_CANCELLED: "Cancelamento",
  BOOKING_RESCHEDULED: "Reagendamento",
};

function readSeenAt(): number {
  try {
    return Number(window.localStorage.getItem(SEEN_KEY)) || 0;
  } catch {
    return 0;
  }
}

function formatWhen(iso: string) {
  return formatDateTimeInTimeZone(iso, BUSINESS_CONFIG.timezone, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** Persistent booking alerts for the owner: the shop's single WhatsApp number cannot alert itself. */
export function AdminAlerts() {
  const [alerts, setAlerts] = useState<OwnerAlert[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [seenAt, setSeenAt] = useState(0);
  const [open, setOpen] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/admin/alerts", { credentials: "same-origin", cache: "no-store", signal });
      if (!response.ok) throw new Error(String(response.status));
      const body = (await response.json()) as { alerts: OwnerAlert[] };
      setAlerts(body.alerts);
      setFailed(false);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) setFailed(true);
    }
  }, []);

  useEffect(() => {
    setSeenAt(readSeenAt());
    const controller = new AbortController();
    void load(controller.signal);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [load]);

  const unseen = (alerts ?? []).filter((alert) => new Date(alert.createdAt).getTime() > seenAt).length;

  const markSeen = () => {
    const latest = Math.max(Date.now(), ...(alerts ?? []).map((alert) => new Date(alert.createdAt).getTime()));
    setSeenAt(latest);
    try {
      window.localStorage.setItem(SEEN_KEY, String(latest));
    } catch {
      // Storage may be unavailable (private mode); the badge then resets on reload.
    }
  };

  return (
    <section aria-labelledby="admin-alerts-title" className="premium-card mb-4 rounded-2xl p-4 sm:mb-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="admin-alerts-title" className="text-lg font-semibold text-zinc-100">
          Avisos de agendamento
          {unseen > 0 && (
            <span className="ml-2 rounded-full border border-warning/50 bg-warning/15 px-2 py-0.5 align-middle text-xs font-semibold text-warning-soft">
              {unseen} {unseen === 1 ? "novo" : "novos"}
            </span>
          )}
        </h2>
        <div className="flex gap-2">
          {unseen > 0 && (
            <button type="button" onClick={markSeen} className="min-h-11 rounded-lg border border-zinc-700 px-3 text-sm text-zinc-200 hover:border-zinc-500">
              Marcar como vistos
            </button>
          )}
          <button
            type="button"
            aria-expanded={open}
            aria-controls="admin-alerts-list"
            onClick={() => setOpen((value) => !value)}
            className="min-h-11 rounded-lg border border-zinc-700 px-3 text-sm text-zinc-200 hover:border-zinc-500"
          >
            {open ? "Ocultar" : "Ver avisos"}
          </button>
        </div>
      </div>
      <p className="sr-only" aria-live="polite">
        {unseen > 0 ? `${unseen} ${unseen === 1 ? "aviso novo" : "avisos novos"} de agendamento` : ""}
      </p>
      {open && (
        <div id="admin-alerts-list" className="mt-3">
          {failed && <p role="alert" className="text-sm text-danger-soft">Não foi possível atualizar os avisos. Nova tentativa em 1 minuto.</p>}
          {alerts === null && !failed && <p className="text-sm text-copy-muted">Carregando avisos…</p>}
          {alerts?.length === 0 && <p className="text-sm text-copy-muted">Nenhum aviso nos últimos 7 dias.</p>}
          {alerts && alerts.length > 0 && (
            <ul className="divide-y divide-zinc-800">
              {alerts.map((alert) => {
                const isNew = new Date(alert.createdAt).getTime() > seenAt;
                return (
                  <li key={alert.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 text-sm">
                    <span className="font-semibold text-zinc-100">
                      {isNew && <span className="sr-only">Novo: </span>}
                      {EVENT_LABELS[alert.event]}
                      {alert.occurrences > 1 && ` · ${alert.occurrences} horários`}
                    </span>
                    <span className="text-zinc-400">
                      {alert.booking
                        ? `${alert.booking.customerName} · ${alert.booking.serviceName} · ${formatWhen(alert.booking.start)}`
                        : "Agendamento removido"}
                    </span>
                    <time dateTime={alert.createdAt} className="text-xs text-copy-muted">{formatWhen(alert.createdAt)}</time>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
