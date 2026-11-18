"use client";

import Link from "next/link";
import { AuthFeedback } from "@/components/auth/auth-shell";
import { AuthInput, AuthSubmitButton, PasswordField, PhoneField } from "@/components/auth/auth-fields";

export type RecoveryStep = "phone" | "code" | "password" | "done";
export type RecoveryStatus =
  | "idle" | "sent" | "unavailable" | "rate_limited" | "invalid"
  | "expired" | "locked" | "error" | "verified" | "completed";

export type RecoveryState = {
  step: RecoveryStep;
  status: RecoveryStatus;
  message: string;
  phone?: string;
  retryAfterSeconds?: number;
  cooldownStartedAt?: number;
};

export const initialRecoveryState: RecoveryState = { step: "phone", status: "idle", message: "" };

const SUCCESS_STATUSES = new Set<RecoveryStatus>(["sent", "verified", "completed"]);
const STEP_LABELS: Array<[RecoveryStep, string]> = [["phone", "Telefone"], ["code", "Código"], ["password", "Nova senha"]];

type StepProps = { state: RecoveryState; formAction: (formData: FormData) => void; pending: boolean };

function Feedback({ state }: { state: RecoveryState }) {
  return <AuthFeedback message={state.message} success={SUCCESS_STATUSES.has(state.status)} />;
}

function Intent({ value }: { value: "request" | "verify" | "complete" }) {
  return <input type="hidden" name="intent" value={value} />;
}

export function RecoveryProgress({ step }: { step: RecoveryStep }) {
  const currentIndex = step === "done" ? STEP_LABELS.length : STEP_LABELS.findIndex(([key]) => key === step);
  return (
    <ol className="mb-5 mt-2 grid grid-cols-3 gap-2 text-xs font-semibold" aria-label="Etapas da recuperação de senha">
      {STEP_LABELS.map(([key, label], index) => {
        let state = "pendente";
        if (index < currentIndex) state = "concluída";
        else if (index === currentIndex) state = "atual";
        return (
          <li
            key={key}
            aria-current={index === currentIndex ? "step" : undefined}
            className={`rounded-full border px-3 py-1.5 text-center ${index <= currentIndex ? "border-brand-highlight text-brand-highlight" : "border-white/15 opacity-60"}`}
          >
            <span className="sr-only">Etapa {index + 1}, {state}: </span>{label}
          </li>
        );
      })}
    </ol>
  );
}

export function PhoneStep({ state, formAction, pending }: StepProps) {
  const hasError = state.status === "error";
  return (
    <form action={formAction} className="auth-form" aria-busy={pending}>
      <Intent value="request" />
      <Feedback state={state} />
      <PhoneField id="recovery-phone" name="phone" label="Telefone cadastrado" defaultValue={state.phone} disabled={pending} error={hasError} />
      <p className="auth-field-hint -mt-2">Vamos enviar um código de 8 números para o WhatsApp deste telefone.</p>
      <AuthSubmitButton pending={pending} idleLabel="Enviar código" pendingLabel="Enviando..." />
    </form>
  );
}

export function CodeStep({ state, formAction, pending, cooldownSeconds }: StepProps & { cooldownSeconds: number }) {
  const needsNewCode = state.status === "expired" || state.status === "locked";
  const resendLabel = cooldownSeconds > 0 ? `Pedir novo código em ${cooldownSeconds}s` : "Pedir novo código";
  return (
    <>
      {needsNewCode ? <Feedback state={state} /> : (
        <form action={formAction} className="auth-form" aria-busy={pending}>
          <Intent value="verify" />
          <Feedback state={state} />
          <AuthInput
            id="recovery-code"
            name="code"
            label="Código de 8 números"
            icon="lock"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{8}"
            maxLength={8}
            required
            disabled={pending}
            error={state.status === "invalid"}
            hint={`O código vale por 10 minutos. Depois de 5 tentativas incorretas, ele é bloqueado.`}
          />
          <AuthSubmitButton pending={pending} idleLabel="Confirmar código" pendingLabel="Confirmando..." />
        </form>
      )}
      <form action={formAction} className="mt-3" aria-busy={pending}>
        <Intent value="request" />
        <input type="hidden" name="phone" value={state.phone ?? ""} />
        <button
          type="submit"
          className={`${needsNewCode ? "button-primary" : "button-secondary"} w-full`}
          disabled={pending || cooldownSeconds > 0}
          aria-disabled={pending || cooldownSeconds > 0}
        >
          {resendLabel}
        </button>
      </form>
      <p className="auth-footer">
        Não recebeu? Confira se o número está correto ou <Link href="/esqueci-minha-senha">use outro telefone</Link>.
      </p>
    </>
  );
}

export function PasswordStep({ state, formAction, pending }: StepProps) {
  const hasError = state.status === "error";
  return (
    <form action={formAction} className="auth-form" aria-busy={pending}>
      <Intent value="complete" />
      <Feedback state={state} />
      <PasswordField id="recovery-password" label="Nova senha" autoComplete="new-password" disabled={pending} error={hasError} hint="Use pelo menos 8 caracteres." />
      <PasswordField id="recovery-password-confirm" name="confirmPassword" label="Confirme a nova senha" autoComplete="new-password" disabled={pending} error={hasError} />
      <p className="auth-field-hint -mt-2">Por segurança, todos os acessos abertos com a senha anterior serão encerrados.</p>
      <AuthSubmitButton pending={pending} idleLabel="Salvar nova senha" pendingLabel="Salvando..." />
    </form>
  );
}

export function DoneStep({ state }: { state: RecoveryState }) {
  return (
    <>
      <Feedback state={state} />
      <Link href="/cliente/login?senha=redefinida" className="button-primary mt-5 w-full">Entrar com a nova senha</Link>
    </>
  );
}
