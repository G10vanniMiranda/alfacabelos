"use client";

import { useState, type InputHTMLAttributes } from "react";

type IconName = "email" | "lock" | "phone" | "user";

function FieldIcon({ name }: { name: IconName }) {
  const common = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (name === "email") return <svg {...common}><path d="M4 6h16v12H4z"/><path d="m4 7 8 6 8-6"/></svg>;
  if (name === "phone") return <svg {...common}><path d="M7 3h3l1.2 4-2 1.6a15 15 0 0 0 6.2 6.2l1.6-2L21 14v3c0 2-1 4-4 4C9.3 21 3 14.7 3 7c0-3 2-4 4-4Z"/></svg>;
  if (name === "user") return <svg {...common}><circle cx="12" cy="8" r="4"/><path d="M4 21c.7-4.2 3.3-6 8-6s7.3 1.8 8 6"/></svg>;
  return <svg {...common}><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>;
}

type AuthInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "className"> & {
  label: string;
  icon: IconName;
  hint?: string;
  error?: boolean;
};

export function AuthInput({ label, icon, hint, error = false, id, ...props }: AuthInputProps) {
  const describedBy = [hint ? `${id}-hint` : "", error ? "auth-feedback" : ""].filter(Boolean).join(" ") || undefined;
  return (
    <div className="auth-field">
      {label ? <label htmlFor={id}>{label}</label> : null}
      <div className="auth-input-wrap">
        <span className="auth-input-icon" aria-hidden="true"><FieldIcon name={icon} /></span>
        <input id={id} aria-invalid={error || undefined} aria-describedby={describedBy} {...props} />
      </div>
      {hint ? <p id={`${id}-hint`} className="auth-field-hint">{hint}</p> : null}
    </div>
  );
}

export function PasswordField({ label = "Senha", id, error = false, disabled, autoComplete = "current-password", name = "password", hint, required = true }: {
  label?: string;
  id: string;
  error?: boolean;
  disabled?: boolean;
  autoComplete?: "current-password" | "new-password";
  name?: string;
  hint?: string;
  required?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const describedBy = [hint ? `${id}-hint` : "", error ? "auth-feedback" : ""].filter(Boolean).join(" ") || undefined;
  return (
    <div className="auth-field">
      {label ? <label htmlFor={id}>{label}</label> : null}
      <div className="auth-input-wrap">
        <span className="auth-input-icon" aria-hidden="true"><FieldIcon name="lock" /></span>
        <input id={id} name={name} type={visible ? "text" : "password"} autoComplete={autoComplete} required={required} disabled={disabled} minLength={autoComplete === "new-password" ? 8 : undefined} aria-invalid={error || undefined} aria-describedby={describedBy} />
        <button type="button" className="auth-password-toggle" onClick={() => setVisible((value) => !value)} aria-label={visible ? "Ocultar senha" : "Exibir senha"} aria-pressed={visible} disabled={disabled}>
          {visible ? "Ocultar" : "Exibir"}
        </button>
      </div>
      {hint ? <p id={`${id}-hint`} className="auth-field-hint">{hint}</p> : null}
    </div>
  );
}

function formatPhoneInput(raw: string) {
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("55") && digits.length > 11) digits = digits.slice(2);
  digits = digits.slice(0, 11);
  if (!digits) return "";
  if (digits.length <= 2) return `(${digits}`;
  const prefixSize = digits.length === 11 ? 5 : 4;
  const prefix = digits.slice(2, 2 + prefixSize);
  const suffix = digits.slice(2 + prefixSize);
  return `(${digits.slice(0, 2)}) ${prefix}${suffix ? `-${suffix}` : ""}`;
}

export function PhoneField({ id, name = "phone", label = "Telefone", error = false, disabled, defaultValue = "" }: { id: string; name?: string; label?: string; error?: boolean; disabled?: boolean; defaultValue?: string }) {
  const [value, setValue] = useState(() => formatPhoneInput(defaultValue));
  return (
    <AuthInput
      id={id}
      name={name}
      label={label}
      icon="phone"
      type="tel"
      inputMode="tel"
      autoComplete="tel"
      placeholder="(69) 99999-9999"
      value={value}
      onChange={(event) => setValue(formatPhoneInput(event.target.value))}
      maxLength={15}
      required
      disabled={disabled}
      error={error}
    />
  );
}

export function AuthSubmitButton({ pending, idleLabel = "Entrar", pendingLabel = "Entrando..." }: { pending: boolean; idleLabel?: string; pendingLabel?: string }) {
  return (
    <button type="submit" disabled={pending} className="button-primary auth-submit" aria-disabled={pending}>
      {pending ? <span className="auth-spinner" aria-hidden="true" /> : null}
      {pending ? pendingLabel : idleLabel}
    </button>
  );
}
