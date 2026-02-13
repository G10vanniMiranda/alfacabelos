import { redirect } from "next/navigation";
import { SchedulerWizard } from "@/components/scheduler/scheduler-wizard";
import { SiteHeader } from "@/components/ui/site-header";
import { getCurrentClient } from "@/lib/actions/client-auth-actions";
import { listServices } from "@/lib/booking-service";

export const metadata = {
  title: "Agendar | ALFA Barber",
};

export default async function AgendarPage() {
  const client = await getCurrentClient();

  if (!client) {
    redirect("/cliente/login?next=/agendar");
  }

  const services = await listServices();

  return (
    <div className="min-h-screen pb-20">
      <SiteHeader />
      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <h1 className="text-4xl font-bold text-zinc-100">Agendar atendimento</h1>
        <p className="mt-2 text-zinc-400">Escolha serviço, horário e confirme em poucos passos.</p>
        <div className="mt-6 animate-fade-up">
          <SchedulerWizard
            services={services}
            initialCustomer={{ name: client.name, phone: client.phone }}
          />
        </div>
      </main>
    </div>
  );
}
