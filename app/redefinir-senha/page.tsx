import { AuthShell } from "@/components/auth/auth-shell";
import { InvalidPasswordResetToken, PasswordResetForm } from "@/components/client/password-reset-form";
import { validatePasswordResetToken } from "@/lib/auth/client-password-reset-store";

export const metadata = { title: "Redefinir senha" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  const validation = await validatePasswordResetToken(token);
  const valid = validation.valid;

  return (
    <AuthShell
      context={valid ? "Segurança da conta" : "Link indisponível"}
      title={valid ? "Crie uma nova senha" : "Não foi possível continuar"}
      description={valid ? "Escolha uma senha segura e diferente das que você já utiliza." : "Confira o estado do link e solicite novas instruções, se necessário."}
      highlights={["Sessões antigas serão encerradas", "Token de uso único", "Acesso protegido"]}
    >
      {valid ? <PasswordResetForm token={token} /> : <InvalidPasswordResetToken status={validation.status} />}
    </AuthShell>
  );
}
