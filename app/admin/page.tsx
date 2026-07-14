import { redirect } from "next/navigation";
import { AdminLogin } from "@/components/admin/admin-login";
import { AuthFeedback, AuthShell } from "@/components/auth/auth-shell";
import { adminLogoutAction, getStaffAuthentication } from "@/lib/actions/booking-actions";
import { getSafeStaffPath } from "@/lib/safe-redirect";

export const metadata = { title: "Acesso da equipe" };

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ next?: string; reason?: string }> }) {
  const params = await searchParams;
  const staff = await getStaffAuthentication();
  if (staff && params.reason !== "access-denied") redirect(getSafeStaffPath(params.next, staff.role));

  if (staff) {
    return (
      <AuthShell context="Acesso indisponível" title="Perfil sem acesso" description="Seu perfil profissional precisa ser revisado antes que você possa continuar.">
        <AuthFeedback message="Não há um profissional ativo vinculado a este acesso. Fale com um administrador da barbearia." />
        <form action={adminLogoutAction} className="mt-5">
          <button type="submit" className="button-primary w-full">Sair e usar outro acesso</button>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      context="Equipe Alfa"
      title="Acesso da equipe"
      description="Entre com suas credenciais profissionais para acessar sua área de trabalho."
      highlights={["Agenda e operação em tempo real", "Acesso protegido por perfil", "Experiência otimizada para a equipe"]}
    >
      <AdminLogin sessionExpired={params.reason === "session-expired"} />
    </AuthShell>
  );
}
