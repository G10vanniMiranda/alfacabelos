import { Suspense } from "react";
import { ClientRegisterForm } from "@/components/client/client-register-form";

export const metadata = {
  title: "Cadastro Cliente | ALFA Barber",
};

export default function ClientRegisterPage() {
  return (
    <div className="min-h-screen pb-12">
      <main className="mx-auto max-w-6xl px-4 sm:px-6">
        <Suspense fallback={<div className="mx-auto mt-12 w-full max-w-md text-sm text-zinc-400">Carregando...</div>}>
          <ClientRegisterForm />
        </Suspense>
      </main>
    </div>
  );
}
