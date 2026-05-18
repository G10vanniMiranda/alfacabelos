import { redirect } from "next/navigation";
import { SchedulerWizard } from "@/components/scheduler/scheduler-wizard";
import { ToastProvider } from "@/components/ui/toast";
import { getCurrentClient } from "@/lib/actions/client-auth-actions";
import { listServices } from "@/lib/booking-service";

export const metadata = {
  title: "Agendar | ALFA Barber",
};

export default async function AgendarPage() {
  const client = await getCurrentClient();

  if (!client) {
    redirect("/cliente/login?next=/cliente");
  }

  const services = await listServices();

  return (
    <div className="min-h-screen pb-20">
      <ToastProvider>
        <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:py-10">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-200">Agenda online</p>
              <h1 className="mt-2 text-3xl font-bold text-zinc-100 sm:text-4xl">Agendar atendimento</h1>
              <p className="mt-2 max-w-2xl text-sm text-zinc-400 sm:text-base">
                Escolha o servico, veja os horarios disponiveis em tempo real e confirme seu atendimento.
              </p>
            </div>
          </div>
          <div className="mt-6 animate-fade-up">
            <SchedulerWizard
              services={services}
              initialCustomer={{ name: client.name, phone: client.phone }}
            />
          </div>
        </main>
      </ToastProvider>
    </div>
  );
}
