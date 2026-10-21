import { ClientBookingActions } from "@/components/client/client-booking-actions";
import { StatusBadge } from "@/components/ui/status-badge";
import { BUSINESS_CONFIG } from "@/lib/config";
import { formatBRLFromCents, formatDateTimeInTimeZone } from "@/lib/utils";
import { buildBookingWhatsAppUrl } from "@/lib/booking-whatsapp-url";
import type { BookingWithRelations } from "@/types/domain";

function rebookHref(booking: BookingWithRelations) {
  return `/agendar?bookingId=${encodeURIComponent(booking.id)}&serviceId=${encodeURIComponent(booking.serviceId)}&barberId=${encodeURIComponent(booking.barberId)}`;
}

export function ClientBookingCard({
  booking,
  featured = false,
  canManage = true,
}: {
  booking: BookingWithRelations;
  featured?: boolean;
  canManage?: boolean;
}) {
  const formattedDate = formatDateTimeInTimeZone(booking.dateTimeStart, BUSINESS_CONFIG.timezone);
  return (
    <article className={`rounded-2xl border p-5 ${featured ? "border-brand-highlight/30 bg-brand-highlight/[0.06]" : "border-white/[0.08] bg-white/[0.025]"}`}>
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold text-stone-100">{booking.service.name}</h3>
            <StatusBadge status={booking.status} />
          </div>
          <p className="mt-3 text-base font-semibold capitalize text-brand-soft">{formattedDate}</p>
          <p className="mt-1 text-sm text-stone-400">com {booking.barber.name} • {booking.service.durationMinutes} min • {formatBRLFromCents(booking.service.priceCents)}</p>
        </div>
        {featured ? <span className="w-fit rounded-full border border-brand-highlight/25 bg-brand-highlight/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-brand-soft">Próximo</span> : null}
      </div>
      <div className="mt-5 border-t border-white/[0.08] pt-4">
        <ClientBookingActions bookingId={booking.id} status={booking.status} rebookHref={rebookHref(booking)} whatsappHref={buildBookingWhatsAppUrl(booking)} canManage={canManage} isRecurring={Boolean(booking.seriesId)} />
      </div>
    </article>
  );
}
