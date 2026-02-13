"use client";

import Link from "next/link";
import { useActionState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { registerClientAction } from "@/lib/actions/client-auth-actions";
import { useToast } from "@/components/ui/toast";

const initialState = { success: false, message: "" };

export function ClientRegisterForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { pushToast } = useToast();
  const next = searchParams.get("next") || "/cliente";
  const [state, formAction, isPending] = useActionState(registerClientAction, initialState);

  useEffect(() => {
    if (!state.message) {
      return;
    }

    pushToast(state.message, state.success ? "success" : "error");
    if (state.success) {
      router.push(next);
    }
  }, [state, next, router, pushToast]);

  return (
    <section className="mx-auto mt-12 w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900/70 p-6">
      <h1 className="text-3xl font-bold text-zinc-100">Cadastro do cliente</h1>
      <p className="mt-2 text-sm text-zinc-400">Crie sua conta para agendar online.</p>

      <form action={formAction} className="mt-5 space-y-4">
        <div>
          <label className="text-sm text-zinc-300">Nome completo</label>
          <input
            name="name"
            className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
          />
        </div>
        <div>
          <label className="text-sm text-zinc-300">Telefone</label>
          <input
            name="phone"
            placeholder="(11) 99999-9999"
            className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
          />
        </div>
        <div>
          <label className="text-sm text-zinc-300">Senha</label>
          <input
            type="password"
            name="password"
            className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
          />
        </div>
        <div>
          <label className="text-sm text-zinc-300">Confirmar senha</label>
          <input
            type="password"
            name="confirmPassword"
            className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
          />
        </div>
        <button
          type="submit"
          disabled={isPending}
          className="w-full rounded-lg bg-cyan-400 px-4 py-2 font-bold text-zinc-950"
        >
          {isPending ? "Criando..." : "Criar conta"}
        </button>
      </form>

      <p className="mt-4 text-sm text-zinc-400">
        Ja possui conta?{" "}
        <Link href={`/cliente/login?next=${encodeURIComponent(next)}`} className="text-cyan-300 hover:text-cyan-200">
          Fazer login
        </Link>
      </p>
    </section>
  );
}
