"use client";

import Link from "next/link";
import { useActionState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthFeedback } from "@/components/auth/auth-shell";
import { AuthInput, AuthSubmitButton, PasswordField, PhoneField } from "@/components/auth/auth-fields";
import { registerClientAction } from "@/lib/actions/client-auth-actions";
import { getSafeInternalPath } from "@/lib/safe-redirect";

const initialState = { success: false, message: "" };

export function ClientRegisterForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const next = getSafeInternalPath(searchParams.get("next"));
  const [state, formAction, isPending] = useActionState(registerClientAction, initialState);
  const hasError = Boolean(state.message && !state.success);

  useEffect(() => {
    if (state.success) router.replace(next);
  }, [state.success, next, router]);

  return (
    <>
      <form action={formAction} className="auth-form" aria-busy={isPending}>
        <AuthFeedback message={state.message} success={state.success} />
        <AuthInput id="register-name" name="name" label="Nome completo" icon="user" autoComplete="name" placeholder="Como podemos chamar você?" minLength={2} required disabled={isPending} error={hasError} />
        <PhoneField id="register-phone" disabled={isPending} error={hasError} />
        <PasswordField id="register-password" label="Crie uma senha" autoComplete="new-password" disabled={isPending} error={hasError} hint="Use pelo menos 8 caracteres." />
        <PasswordField id="register-password-confirm" name="confirmPassword" label="Confirme sua senha" autoComplete="new-password" disabled={isPending} error={hasError} />
        <AuthSubmitButton pending={isPending} idleLabel="Criar minha conta" pendingLabel="Criando conta..." />
      </form>
      <p className="auth-footer">
        Já possui uma conta?{" "}
        <Link href={`/cliente/login?next=${encodeURIComponent(next)}`}>Entrar</Link>
      </p>
    </>
  );
}
