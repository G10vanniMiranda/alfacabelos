import { Suspense } from "react";
import { ClientLoginForm } from "@/components/client/client-login-form";

export const metadata = {
  title: "Login Cliente | ALFA Barber",
};

export default function ClientLoginPage() {
  return (
    <div className="min-h-screen pb-12">
      <main className="mx-auto max-w-6xl px-4 sm:px-6">
        <Suspense fallback={<div className="mx-auto mt-12 w-full max-w-md text-sm text-zinc-400">Carregando...</div>}>
          <ClientLoginForm />
        </Suspense>
      </main>
    </div>
  );
}
