import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { ClientLoginForm } from "@/components/client/client-login-form";
import { getCurrentClient } from "@/lib/actions/client-auth-actions";
import { getSafeInternalPath } from "@/lib/safe-redirect";

export const metadata = { title: "Entrar na minha conta" };

export default async function ClientLoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const params = await searchParams;
  const next = getSafeInternalPath(params.next);
  if (await getCurrentClient()) redirect(next);

  return (
    <AuthShell
      context="Área do cliente"
      title="Bem-vindo de volta"
      description="Entre para agendar, reagendar e acompanhar seus horários."
      highlights={["Agende em poucos passos", "Acompanhe seus próximos horários", "Reagende com praticidade"]}
    >
      <Suspense fallback={<p className="mt-6 text-sm text-[var(--muted)]">Preparando acesso...</p>}>
        <ClientLoginForm />
      </Suspense>
    </AuthShell>
  );
}
