import { redirect } from "next/navigation";
import { SchedulerWizard } from "@/components/scheduler/scheduler-wizard";
import { ToastProvider } from "@/components/ui/toast";
import { getCurrentClient } from "@/lib/actions/client-auth-actions";
import { listBarbers, listClientBookings, listServices } from "@/lib/booking-service";

export const metadata = {
  title: "Agendar | ALFA Barber",
};

function currentTimestamp() {
  return Date.now();
}

export default async function AgendarPage({ searchParams }: { searchParams: Promise<{ serviceId?: string; barberId?: string; bookingId?: string }> }) {
  const client = await getCurrentClient();

  if (!client) {
    redirect("/cliente/login?next=/agendar");
  }

  const [services, barbers] = await Promise.all([listServices(), listBarbers()]);
  const requested = await searchParams;
  const clientBookings = requested.bookingId ? await listClientBookings(client.id) : [];
  const rescheduleBooking = clientBookings.find(
    (booking) => booking.id === requested.bookingId && booking.clientId === client.id && booking.status !== "CANCELADO" && new Date(booking.dateTimeStart).getTime() > currentTimestamp(),
  );
  const initialSelection = {
    serviceId: rescheduleBooking?.serviceId ?? (services.some((item) => item.id === requested.serviceId) ? requested.serviceId : undefined),
    barberId: rescheduleBooking?.barberId ?? (barbers.some((item) => item.id === requested.barberId) ? requested.barberId : undefined),
    rescheduleBookingId: rescheduleBooking?.id,
  };

  return (
    <div className="min-h-screen pb-20">
      <ToastProvider>
        <main id="conteudo" className="shell py-8 lg:py-12">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="eyebrow">Agenda online</p>
              <h1 className="mt-3 text-3xl font-semibold text-stone-100 sm:text-5xl">Encontre seu melhor horário.</h1>
              <p className="mt-2 max-w-2xl text-sm text-zinc-400 sm:text-base">
                Escolha o serviço e o profissional. Os horários são atualizados em tempo real.
              </p>
            </div>
          </div>
          <div className="mt-6 animate-fade-up">
            <SchedulerWizard
              services={services}
              barbers={barbers}
              initialSelection={initialSelection}
              initialCustomer={{ name: client.name, phone: client.phone }}
            />
          </div>
        </main>
      </ToastProvider>
    </div>
  );
}
