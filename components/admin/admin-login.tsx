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
    <section className="mx-auto mt-16 w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900/70 p-6 shadow-2xl shadow-cyan-950/30">
      <h1 className="text-2xl font-bold text-zinc-100">Área Admin</h1>
      <p className="mt-2 text-sm text-zinc-400">Entre com email e senha para acessar o painel administrativo.</p>
      <form action={formAction} className="mt-5 space-y-4">
        <div className="space-y-2">
          <label htmlFor="admin-email" className="block text-sm font-medium text-zinc-300">
            Email
          </label>
          <input
            id="admin-email"
            name="email"
            type="email"
            placeholder="admin@alfa.com"
            autoComplete="email"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100 outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/30"
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="admin-password" className="block text-sm font-medium text-zinc-300">
            Senha
          </label>
          <input
            id="admin-password"
            name="password"
            type="password"
            autoComplete="current-password"
            placeholder="Digite sua senha"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100 outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/30"
          />
        </div>
        <button
          type="submit"
          disabled={isPending}
          className="w-full rounded-lg bg-cyan-400 px-4 py-2 font-bold text-zinc-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isPending ? "Entrando..." : "Acessar painel"}
        </button>
      </form>
    </section>
  );
}

