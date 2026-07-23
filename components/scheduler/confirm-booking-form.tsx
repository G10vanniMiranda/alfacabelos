"use client";

import { useActionState } from "react";
import { confirmBookingByTokenFormAction } from "@/lib/actions/booking-actions";

const initialState = { success: false, message: "" };

export function ConfirmBookingForm({ token }: { token: string }) {
  const [state, formAction, isPending] = useActionState(confirmBookingByTokenFormAction, initialState);

  if (state.success) {
    return (
      <div className="ui-alert ui-alert-success text-sm font-semibold">
        {state.message}
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="token" value={token} />
      {state.message ? (
        <div className="ui-alert ui-alert-warning text-sm">
          {state.message}
        </div>
      ) : null}
      <button
        type="submit"
        disabled={isPending}
        className="button-primary w-full px-4 py-3 disabled:opacity-60 sm:w-auto"
      >
        {isPending ? "Confirmando..." : "Confirmar agendamento"}
      </button>
    </form>
  );
}
