"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cancelMyBookingAction, confirmMyBookingAction } from "@/lib/actions/client-auth-actions";
import type { BookingStatus } from "@/types/domain";

type ClientBookingActionsProps = {
  bookingId: string;
  status: BookingStatus;
  rebookHref: string;
  whatsappHref: string;
  canManage?: boolean;
};

export function ClientBookingActions({ bookingId, status, rebookHref, whatsappHref, canManage = true }: ClientBookingActionsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showCancel, setShowCancel] = useState(false);
  const [message, setMessage] = useState("");

  function runAction(action: (formData: FormData) => Promise<void>, successMessage: string) {
    const formData = new FormData();
    formData.set("bookingId", bookingId);
    startTransition(async () => {
      try {
        await action(formData);
        setMessage(successMessage);
        setShowCancel(false);
        router.refresh();
      } catch {
        setMessage("Não foi possível concluir agora. Tente novamente ou fale com a equipe.");
      }
    });
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {status === "PENDENTE" && canManage ? (
          <button
            type="button"
            disabled={isPending}
            onClick={() => runAction(confirmMyBookingAction, "Agendamento confirmado.")}
            className="button-primary min-h-10 px-3 py-2 text-xs"
          >
            {isPending ? "Confirmando…" : "Confirmar"}
          </button>
        ) : null}
        {status !== "CANCELADO" && canManage ? (
          <>
            <Link href={rebookHref} className="button-secondary min-h-10 px-3 py-2 text-xs">Reagendar</Link>
            <button type="button" onClick={() => setShowCancel(true)} className="button-ghost min-h-10 px-3 py-2 text-xs text-red-200">
              Cancelar
            </button>
          </>
        ) : <Link href={rebookHref} className="button-secondary min-h-10 px-3 py-2 text-xs">Agendar novamente</Link>}
        <a href={whatsappHref} target="_blank" rel="noopener noreferrer" className="button-ghost min-h-10 px-3 py-2 text-xs">
          Falar com a equipe
        </a>
      </div>

      {message ? <p role="status" className="mt-3 text-xs text-emerald-200">{message}</p> : null}

      {showCancel ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4 backdrop-blur-sm" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setShowCancel(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby={`cancel-${bookingId}`} className="premium-card w-full max-w-md rounded-2xl p-6">
            <p className="eyebrow">Confirmação</p>
            <h2 id={`cancel-${bookingId}`} className="mt-2 text-2xl font-semibold text-stone-100">Cancelar este horário?</h2>
            <p className="mt-3 text-sm leading-6 text-stone-400">O horário voltará a ficar disponível. Se quiser apenas trocar a data, fale com a equipe para reagendar.</p>
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" disabled={isPending} onClick={() => setShowCancel(false)} className="button-secondary">Manter horário</button>
              <button type="button" disabled={isPending} onClick={() => runAction(cancelMyBookingAction, "Agendamento cancelado.")} className="button-secondary border-red-400/40 text-red-100 hover:bg-red-500/10">
                {isPending ? "Cancelando…" : "Sim, cancelar"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
