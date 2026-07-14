import { AuthShell } from "@/components/auth/auth-shell";
import { PasswordResetRequestForm } from "@/components/client/password-reset-request-form";

export const metadata = { title: "Recuperar senha" };

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      context="Recuperação de acesso"
      title="Recupere sua senha"
      description="Informe seu telefone cadastrado para receber instruções seguras de recuperação."
      highlights={["Link temporário e protegido", "Instruções enviadas por WhatsApp", "Sua privacidade preservada"]}
    >
      <PasswordResetRequestForm />
    </AuthShell>
  );
}
