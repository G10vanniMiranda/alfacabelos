import { InvalidPasswordResetToken, PasswordResetForm } from "@/components/client/password-reset-form";
import { ToastProvider } from "@/components/ui/toast";
import { validatePasswordResetToken } from "@/lib/auth/client-password-reset-store";

export const metadata = {
  title: "Redefinir Senha | ALFA Barber",
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const params = await searchParams;
  const token = params.token ?? "";
  const validation = await validatePasswordResetToken(token);

  return (
    <div className="min-h-screen pb-12">
      <ToastProvider>
        <main className="mx-auto max-w-6xl px-4 sm:px-6">
          {validation.valid ? <PasswordResetForm token={token} /> : <InvalidPasswordResetToken status={validation.status} />}
        </main>
      </ToastProvider>
    </div>
  );
}
