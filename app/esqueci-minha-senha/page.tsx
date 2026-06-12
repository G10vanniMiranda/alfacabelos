import { PasswordResetRequestForm } from "@/components/client/password-reset-request-form";
import { ToastProvider } from "@/components/ui/toast";

export const metadata = {
  title: "Recuperar Senha | ALFA Barber",
};

export default function ForgotPasswordPage() {
  return (
    <div className="min-h-screen pb-12">
      <ToastProvider>
        <main className="mx-auto max-w-6xl px-4 sm:px-6">
          <PasswordResetRequestForm />
        </main>
      </ToastProvider>
    </div>
  );
}
