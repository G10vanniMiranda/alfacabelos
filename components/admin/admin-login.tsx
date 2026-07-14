"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { AuthFeedback } from "@/components/auth/auth-shell";
import { AuthInput, AuthSubmitButton, PasswordField } from "@/components/auth/auth-fields";
import { adminLoginAction } from "@/lib/actions/booking-actions";

const initialState = { success: false, message: "" };

export function AdminLogin({ sessionExpired = false }: { sessionExpired?: boolean }) {
  const [state, formAction, isPending] = useActionState(adminLoginAction, initialState);
  const router = useRouter();
  const hasError = Boolean(state.message && !state.success);

  useEffect(() => {
    if (state.success) router.refresh();
  }, [state.success, router]);

  return (
    <>
      <form action={formAction} className="auth-form" aria-busy={isPending}>
        {sessionExpired && !state.message ? (
          <AuthFeedback message="Sua sessão expirou. Entre novamente para continuar." />
        ) : null}
        <AuthFeedback message={state.message} success={state.success} />

        <AuthInput
          id="staff-email"
          name="email"
          label="E-mail profissional"
          icon="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="voce@espacoalfa.com.br"
          required
          disabled={isPending}
          error={hasError}
        />
        <PasswordField id="staff-password" disabled={isPending} error={hasError} />
        <AuthSubmitButton pending={isPending} />
      </form>
      <p className="auth-note">
        O acesso é identificado automaticamente pelo seu perfil. Administradores e
        profissionais são direcionados para seus respectivos painéis.
      </p>
    </>
  );
}
