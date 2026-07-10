"use client";

import Link from "next/link";
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { resetClientPasswordAction } from "@/lib/actions/client-auth-actions";
import { useToast } from "@/components/ui/toast";

const initialState = { success: false, message: "" };

export function PasswordResetForm({ token }: { token: string }) {
  const router = useRouter();
  const { pushToast } = useToast();
  const [state, formAction, isPending] = useActionState(resetClientPasswordAction, initialState);

  useEffect(() => {
    if (!state.message) {
      return;
    }

    pushToast(state.message, state.success ? "success" : "error");
    if (state.success) {
      router.push("/cliente/login?senha=redefinida");
    }
  }, [state, router, pushToast]);

  return (
    <section className="mx-auto mt-12 w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900/70 p-6">
      <h1 className="text-3xl font-bold text-zinc-100">Criar nova senha</h1>
      <p className="mt-2 text-sm text-zinc-400">Digite e confirme sua nova senha de acesso.</p>

      <form action={formAction} className="mt-5 space-y-4">
        <input type="hidden" name="token" value={token} />
        <div>
          <label className="text-sm text-zinc-300">Nova senha</label>
          <input
            type="password"
            name="password"
            autoComplete="new-password"
            minLength={8}
            required
            className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
          />
        </div>
        <div>
          <label className="text-sm text-zinc-300">Confirmar nova senha</label>
          <input
            type="password"
            name="confirmPassword"
            autoComplete="new-password"
            minLength={8}
            required
            className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
          />
        </div>
        <button
          type="submit"
          disabled={isPending}
          className="w-full rounded-lg bg-cyan-400 px-4 py-2 font-bold text-zinc-950"
        >
          {isPending ? "Salvando..." : "Redefinir senha"}
        </button>
      </form>
    </section>
  );
}

export function InvalidPasswordResetToken({ status = "invalid" }: { status?: "valid" | "invalid" | "expired" | "used" }) {
  const message =
    status === "expired"
      ? "Este link expirou. Solicite uma nova recuperacao."
      : status === "used"
        ? "Este link ja foi utilizado. Solicite uma nova recuperacao se ainda precisar alterar a senha."
        : "Este link de recuperacao e invalido.";

  return (
    <section className="mx-auto mt-12 w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900/70 p-6">
      <h1 className="text-3xl font-bold text-zinc-100">Link indisponivel</h1>
      <p className="mt-2 text-sm text-zinc-400">{message}</p>
      <Link
        href="/esqueci-minha-senha"
        className="mt-5 inline-flex w-full justify-center rounded-lg bg-cyan-400 px-4 py-2 font-bold text-zinc-950"
      >
        Solicitar novo link
      </Link>
    </section>
  );
}
