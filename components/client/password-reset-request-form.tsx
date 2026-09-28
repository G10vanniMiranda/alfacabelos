"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { AuthFeedback } from "@/components/auth/auth-shell";
import { AuthSubmitButton, PhoneField } from "@/components/auth/auth-fields";
import { requestClientPasswordResetAction } from "@/lib/actions/client-auth-actions";
import type { ActionState } from "@/types/scheduler";

const initialState: ActionState = { success: false, message: "" };

export function PasswordResetRequestForm() {
  const [state, formAction, isPending] = useActionState(requestClientPasswordResetAction, initialState);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const hasError = Boolean(state.message && !state.success);

  useEffect(() => {
    if (!state.message) return;
    document.getElementById("auth-feedback")?.focus();
  }, [state.message, state.success]);

  useEffect(() => {
    if (!state.success || !state.cooldownStartedAt) return;
    const initialTimer = window.setTimeout(() => {
      setCooldownSeconds(state.retryAfterSeconds ?? 60);
    }, 0);
    const timer = window.setInterval(() => {
      setCooldownSeconds((current) => {
        if (current <= 1) {
          window.clearInterval(timer);
          return 0;
        }
        return current - 1;
      });
    }, 1000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, [state.cooldownStartedAt, state.retryAfterSeconds, state.success]);

  const buttonLabel = cooldownSeconds > 0
    ? `Solicitar novamente em ${cooldownSeconds}s`
    : state.success ? "Solicitar novamente" : "Enviar instruções";

  return (
    <>
      <form action={formAction} className="auth-form" aria-busy={isPending}>
        <AuthFeedback message={state.message} success={state.success} />
        <PhoneField id="reset-phone" name="identifier" disabled={isPending} error={hasError} label="Telefone cadastrado" />
        <p className="auth-field-hint -mt-2">
          Enviaremos as instruções por WhatsApp. A mensagem pode levar alguns instantes.
        </p>
        <AuthSubmitButton pending={isPending} disabled={cooldownSeconds > 0} idleLabel={buttonLabel} pendingLabel="Solicitando..." />
      </form>
      <p className="auth-footer">
        Lembrou-se da sua senha? <Link href="/cliente/login">Voltar para entrar</Link>
      </p>
    </>
  );
}
