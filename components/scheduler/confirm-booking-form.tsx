"use client";

import { useActionState } from "react";
import { confirmBookingByTokenFormAction } from "@/lib/actions/booking-actions";

const initialState = { success: false, message: "" };

export function ConfirmBookingForm({ token }: { token: string }) {
  const [state, formAction, isPending] = useActionState(confirmBookingByTokenFormAction, initialState);

  if (state.success) {
    return (
      <div className="rounded-lg border border-emerald-400/40 bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-100">
        {state.message}
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="token" value={token} />
      {state.message ? (
        <div className="rounded-lg border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          {state.message}
        </div>
      ) : null}
      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded-lg bg-cyan-400 px-4 py-3 text-sm font-bold text-zinc-950 transition hover:bg-cyan-300 disabled:opacity-60 sm:w-auto"
      >
        {isPending ? "Confirmando..." : "Confirmar agendamento"}
      </button>
    </form>
  );
}
