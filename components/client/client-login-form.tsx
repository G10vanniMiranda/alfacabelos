"use client";

import Link from "next/link";
import { useActionState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthFeedback } from "@/components/auth/auth-shell";
import { AuthSubmitButton, PasswordField, PhoneField } from "@/components/auth/auth-fields";
import { loginClientAction } from "@/lib/actions/client-auth-actions";
import { getSafeInternalPath } from "@/lib/safe-redirect";
import type { ActionState } from "@/types/scheduler";

const initialState: ActionState = { success: false, message: "" };

export function ClientLoginForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const next = getSafeInternalPath(searchParams.get("next"));
  const passwordReset = searchParams.get("senha") === "redefinida";
  const sessionExpired = searchParams.get("reason") === "session-expired";
  const [state, formAction, isPending] = useActionState(loginClientAction, initialState);
  const hasError = Boolean(state.message && !state.success);

  useEffect(() => {
    if (state.success) router.replace(next);
  }, [state.success, next, router]);

  return (
    <>
      <form action={formAction} className="auth-form" aria-busy={isPending}>
        <input type="hidden" name="next" value={next} />
        {passwordReset && !state.message ? <AuthFeedback message="Senha redefinida com sucesso. Entre para continuar." success /> : null}
        {sessionExpired && !state.message && !passwordReset ? <AuthFeedback message="Sua sessão expirou. Entre novamente para continuar." /> : null}
        <AuthFeedback message={state.message} success={state.success} />

        <PhoneField id="client-phone" disabled={isPending} error={hasError} />
        <div className="auth-field">
          <div className="auth-form-row">
            <label htmlFor="client-password">Senha</label>
            <Link href="/esqueci-minha-senha" className="auth-inline-link text-xs">Esqueci minha senha</Link>
          </div>
          <PasswordField id="client-password" label="" disabled={isPending} error={hasError} />
        </div>
        <AuthSubmitButton pending={isPending} />
      </form>

      {state.code === "PASSWORD_SETUP_REQUIRED" ? (
        <Link href="/esqueci-minha-senha" className="button-secondary mt-3 w-full">Criar minha primeira senha</Link>
      ) : null}

      <p className="auth-footer">
        Ainda não tem uma conta?{" "}
        <Link href={`/cliente/cadastro?next=${encodeURIComponent(next)}`}>Criar minha conta</Link>
      </p>
    </>
  );
}
