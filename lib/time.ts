import { BUSINESS_CONFIG } from "@/lib/config";
import { getDayRangeIso, getTimeLabel, overlaps, toMinutes } from "@/lib/utils";
import { AvailableSlot } from "@/types/scheduler";
import { BlockedSlot, Booking, DailyOperatingConfig } from "@/types/domain";

function getBusinessHours(dayOfWeek: number, operatingHours: DailyOperatingConfig[]): DailyOperatingConfig | undefined {
  return operatingHours.find((entry) => entry.dayOfWeek === dayOfWeek);
}

export function generateAvailableSlots(params: {
  date: string;
  barberId: string;
  serviceDurationMinutes: number;
  barberBookings: Booking[];
  blockedSlots: BlockedSlot[];
}): AvailableSlot[] {
  const { date, barberId, serviceDurationMinutes, barberBookings, blockedSlots } = params;
  const day = new Date(`${date}T12:00:00`).getDay();
  const businessHours = getBusinessHours(day, BUSINESS_CONFIG.operatingHours);

  if (!businessHours) {
    return [];
  }

  const startMinutes = toMinutes(businessHours.open);
  const endMinutes = toMinutes(businessHours.close);
  const slots: AvailableSlot[] = [];
  const now = new Date();

  for (
    let currentMinutes = startMinutes;
    currentMinutes + serviceDurationMinutes <= endMinutes;
    currentMinutes += BUSINESS_CONFIG.slotIntervalMinutes
  ) {
    const hours = Math.floor(currentMinutes / 60);
    const minutes = currentMinutes % 60;

    const start = new Date(`${date}T${hours.toString().padStart(2, "0")}:${minutes
      .toString()
      .padStart(2, "0")}:00`);

    const end = new Date(start);
    end.setMinutes(end.getMinutes() + serviceDurationMinutes + BUSINESS_CONFIG.bufferBetweenBookingsMinutes);

    if (start < now) {
      continue;
    }

    const conflictsWithBookings = barberBookings.some((booking) => {
      if (booking.status === "CANCELADO") {
        return false;
      }
      return overlaps(start, end, new Date(booking.dateTimeStart), new Date(booking.dateTimeEnd));
    });

    if (conflictsWithBookings) {
      continue;
    }

    const conflictsWithBlocked = blockedSlots.some((blocked) => {
      if (blocked.barberId && blocked.barberId !== barberId) {
        return false;
      }
      return overlaps(start, end, new Date(blocked.dateTimeStart), new Date(blocked.dateTimeEnd));
    });

    if (conflictsWithBlocked) {
      continue;
    }

    slots.push({
      start: start.toISOString(),
      end: end.toISOString(),
      label: getTimeLabel(start),
    });
  }

  return slots;
}

export function getDayRange(date: string) {
  return getDayRangeIso(date);
}

