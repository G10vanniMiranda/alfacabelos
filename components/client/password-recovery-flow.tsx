"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import {
  completeRecoveryAction,
  requestRecoveryCodeAction,
  verifyRecoveryCodeAction,
} from "@/lib/actions/password-recovery-actions";
import {
  CodeStep,
  DoneStep,
  initialRecoveryState,
  PasswordStep,
  PhoneStep,
  RecoveryProgress,
  type RecoveryState,
} from "@/components/client/password-recovery-steps";

// One state machine: every step submits to the same dispatcher, so the latest
// server answer always decides which step is shown.
async function dispatchRecovery(prev: RecoveryState, formData: FormData): Promise<RecoveryState> {
  const intent = formData.get("intent");
  if (intent === "verify") return verifyRecoveryCodeAction(prev, formData);
  if (intent === "complete") return completeRecoveryAction(prev, formData);
  return requestRecoveryCodeAction(prev, formData);
}

function useCooldown(state: RecoveryState): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!state.cooldownStartedAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [state.cooldownStartedAt]);
  if (!state.cooldownStartedAt || !state.retryAfterSeconds) return 0;
  const remaining = Math.ceil((state.cooldownStartedAt + state.retryAfterSeconds * 1000 - now) / 1000);
  return Math.min(state.retryAfterSeconds, Math.max(0, remaining));
}

export function PasswordRecoveryFlow() {
  const [state, formAction, pending] = useActionState(dispatchRecovery, initialRecoveryState);
  const cooldownSeconds = useCooldown(state);

  useEffect(() => {
    if (state.message) document.getElementById("auth-feedback")?.focus();
  }, [state]);

  return (
    <>
      <RecoveryProgress step={state.step} />
      {state.step === "phone" ? <PhoneStep state={state} formAction={formAction} pending={pending} /> : null}
      {state.step === "code" ? <CodeStep state={state} formAction={formAction} pending={pending} cooldownSeconds={cooldownSeconds} /> : null}
      {state.step === "password" ? <PasswordStep state={state} formAction={formAction} pending={pending} /> : null}
      {state.step === "done" ? <DoneStep state={state} /> : null}
      {state.step === "phone" ? (
        <p className="auth-footer">
          Lembrou-se da sua senha? <Link href="/cliente/login">Voltar para entrar</Link>
        </p>
      ) : null}
    </>
  );
}
