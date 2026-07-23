"use client";

import Link from "next/link";
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { AuthFeedback } from "@/components/auth/auth-shell";
import { AuthSubmitButton, PasswordField } from "@/components/auth/auth-fields";
import { resetClientPasswordAction } from "@/lib/actions/client-auth-actions";

const initialState = { success: false, message: "" };

export function PasswordResetForm({ token }: { token: string }) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(resetClientPasswordAction, initialState);
  const hasError = Boolean(state.message && !state.success);

  useEffect(() => {
    if (!state.success) return;
    const timer = window.setTimeout(() => router.replace("/cliente/login?senha=redefinida"), 650);
    return () => window.clearTimeout(timer);
  }, [state.success, router]);

  return (
    <form action={formAction} className="auth-form" aria-busy={isPending}>
      <input type="hidden" name="token" value={token} />
      <AuthFeedback message={state.message} success={state.success} />
      <PasswordField id="new-password" label="Nova senha" autoComplete="new-password" disabled={isPending} error={hasError} hint="Use pelo menos 8 caracteres." />
      <PasswordField id="new-password-confirm" name="confirmPassword" label="Confirme a nova senha" autoComplete="new-password" disabled={isPending} error={hasError} />
      <AuthSubmitButton pending={isPending} idleLabel="Redefinir senha" pendingLabel="Salvando..." />
    </form>
  );
}

export function InvalidPasswordResetToken({ status = "invalid" }: { status?: "valid" | "invalid" | "expired" | "used" }) {
  const message = status === "expired"
    ? "Este link expirou. Solicite novas instruções de recuperação."
    : status === "used"
      ? "Este link já foi utilizado. Solicite outro caso você ainda precise alterar sua senha."
      : "Não foi possível validar este link de recuperação.";

  return (
    <>
      <AuthFeedback message={message} />
      <Link href="/esqueci-minha-senha" className="button-primary mt-5 w-full">Solicitar novo link</Link>
      <p className="auth-footer"><Link href="/cliente/login">Voltar para entrar</Link></p>
    </>
  );
}
