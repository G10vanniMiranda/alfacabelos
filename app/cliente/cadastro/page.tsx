import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { ClientRegisterForm } from "@/components/client/client-register-form";
import { getCurrentClient } from "@/lib/actions/client-auth-actions";
import { getSafeInternalPath } from "@/lib/safe-redirect";

export const metadata = { title: "Criar minha conta" };

export default async function ClientRegisterPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const params = await searchParams;
  const next = getSafeInternalPath(params.next);
  if (await getCurrentClient()) redirect(next);

  return (
    <AuthShell
      context="Novo cliente"
      title="Crie sua conta"
      description="Tenha seus horários e preferências sempre à mão. Leva menos de um minuto."
      highlights={["Cadastro rápido e seguro", "Seus horários em um só lugar", "Atendimento do seu jeito"]}
    >
      <Suspense fallback={<p className="mt-6 text-sm text-copy-muted">Preparando cadastro...</p>}>
        <ClientRegisterForm />
      </Suspense>
    </AuthShell>
  );
}
