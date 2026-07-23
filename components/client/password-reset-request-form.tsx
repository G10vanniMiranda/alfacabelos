"use client";

import Link from "next/link";
import { useActionState } from "react";
import { AuthFeedback } from "@/components/auth/auth-shell";
import { AuthSubmitButton, PhoneField } from "@/components/auth/auth-fields";
import { requestClientPasswordResetAction } from "@/lib/actions/client-auth-actions";

const initialState = { success: false, message: "" };

export function PasswordResetRequestForm() {
  const [state, formAction, isPending] = useActionState(requestClientPasswordResetAction, initialState);
  const hasError = Boolean(state.message && !state.success);

  return (
    <>
      <form action={formAction} className="auth-form" aria-busy={isPending}>
        <AuthFeedback message={state.message} success={state.success} />
        <PhoneField id="reset-phone" name="identifier" disabled={isPending} error={hasError} label="Telefone cadastrado" />
        <p className="auth-field-hint -mt-2">
          Enviaremos as instruções por WhatsApp. A mensagem pode levar alguns instantes.
        </p>
        <AuthSubmitButton pending={isPending} idleLabel={state.success ? "Solicitar novamente" : "Enviar instruções"} pendingLabel="Enviando..." />
      </form>
      <p className="auth-footer">
        Lembrou-se da sua senha? <Link href="/cliente/login">Voltar para entrar</Link>
      </p>
    </>
  );
}
