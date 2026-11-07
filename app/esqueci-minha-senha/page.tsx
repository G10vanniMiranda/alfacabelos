import { AuthShell } from "@/components/auth/auth-shell";
import { PasswordRecoveryFlow } from "@/components/client/password-recovery-flow";

export const metadata = { title: "Recuperar senha" };

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      context="Recuperação de acesso"
      title="Recupere ou crie sua senha"
      description="Confirme que o telefone é seu com um código de uso único e defina uma nova senha aqui mesmo."
      highlights={["Código de uso único", "Válido por 10 minutos", "Sua privacidade preservada"]}
    >
      <PasswordRecoveryFlow />
    </AuthShell>
  );
}
