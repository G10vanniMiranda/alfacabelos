"use client";

import { useActionState, useEffect } from "react";
import { adminLoginAction } from "@/lib/actions/booking-actions";
import { useToast } from "@/components/ui/toast";

const initialState = { success: false, message: "" };

export function AdminLogin() {
  const [state, formAction, isPending] = useActionState(adminLoginAction, initialState);
  const { pushToast } = useToast();

  useEffect(() => {
    if (!state.message) {
      return;
    }
    pushToast(state.message, state.success ? "success" : "error");
    if (state.success) {
      window.location.reload();
    }
  }, [state, pushToast]);

  return (
    <section className="mx-auto mt-16 w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900/70 p-6">
      <h1 className="text-2xl font-bold text-zinc-100">Area Admin</h1>
      <p className="mt-2 text-sm text-zinc-400">Informe a senha para gerenciar agendamentos.</p>
      <form action={formAction} className="mt-5 space-y-4">
        <input
          name="password"
          type="password"
          placeholder="Senha"
          className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
        />
        <button
          type="submit"
          disabled={isPending}
          className="w-full rounded-lg bg-cyan-400 px-4 py-2 font-bold text-zinc-950"
        >
          {isPending ? "Entrando..." : "Entrar"}
        </button>
      </form>
    </section>
  );
}

