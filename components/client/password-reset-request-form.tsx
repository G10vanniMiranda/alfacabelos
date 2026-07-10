"use client";

import Link from "next/link";
import { useActionState, useEffect } from "react";
import { requestClientPasswordResetAction } from "@/lib/actions/client-auth-actions";
import { useToast } from "@/components/ui/toast";

const initialState = { success: false, message: "" };

export function PasswordResetRequestForm() {
  const { pushToast } = useToast();
  const [state, formAction, isPending] = useActionState(requestClientPasswordResetAction, initialState);

  useEffect(() => {
    if (state.message) {
      pushToast(state.message, state.success ? "success" : "error");
    }
  }, [state, pushToast]);

  return (
    <section className="mx-auto mt-12 w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900/70 p-6">
      <h1 className="text-3xl font-bold text-zinc-100">Recuperar senha</h1>
      <p className="mt-2 text-sm text-zinc-400">
        Informe seu telefone cadastrado para receber as instrucoes por WhatsApp.
      </p>

      <form action={formAction} className="mt-5 space-y-4">
        <div>
          <label className="text-sm text-zinc-300">Telefone</label>
          <input
            name="identifier"
            placeholder="(11) 99999-9999"
            inputMode="tel"
            autoComplete="tel"
            required
            className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
          />
        </div>
        <button
          type="submit"
          disabled={isPending}
          className="w-full rounded-lg bg-cyan-400 px-4 py-2 font-bold text-zinc-950"
        >
          {isPending ? "Enviando..." : "Enviar instrucoes"}
        </button>
      </form>

      <p className="mt-4 text-sm text-zinc-400">
        Lembrou a senha?{" "}
        <Link href="/cliente/login" className="text-cyan-300 hover:text-cyan-200">
          Fazer login
        </Link>
      </p>
    </section>
  );
}
