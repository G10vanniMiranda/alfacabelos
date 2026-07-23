import { BUSINESS_CONFIG } from "@/lib/config";
import { getBookingOccupiedMinutes, mergeOperatingWindows } from "@/lib/scheduling-rules";
import { getDayRangeIso, getTimeLabelInTimeZone, overlaps, toMinutes, zonedDateTimeToUtcIso } from "@/lib/utils";
import { AvailableSlot } from "@/types/scheduler";
import { BlockedSlot, Booking, DailyOperatingConfig } from "@/types/domain";

export function generateAvailableSlots(params: {
  date: string;
  barberId: string;
  serviceDurationMinutes: number;
  serviceIsProcedure?: boolean;
  barberBookings: Booking[];
  blockedSlots: BlockedSlot[];
  operatingHours?: DailyOperatingConfig[];
}): AvailableSlot[] {
  const { date, barberId, serviceDurationMinutes, serviceIsProcedure, barberBookings, blockedSlots, operatingHours } = params;
  const [year, month, dayOfMonth] = date.split("-").map(Number);
  const day = new Date(Date.UTC(year, month - 1, dayOfMonth, 12)).getUTCDay();
  const windows = mergeOperatingWindows(
    (operatingHours ?? BUSINESS_CONFIG.operatingHours).filter((entry) => entry.dayOfWeek === day),
  );
  if (windows.length === 0) {
    return [];
  }
  const slots: AvailableSlot[] = [];
  const now = new Date();
  for (const window of windows) {
    const startMinutes = toMinutes(window.open);
    const endMinutes = toMinutes(window.close);
    const windowEnd = new Date(zonedDateTimeToUtcIso(date, `${window.close}:00`, BUSINESS_CONFIG.timezone));

    for (
      let currentMinutes = startMinutes;
      currentMinutes < endMinutes;
      currentMinutes += BUSINESS_CONFIG.slotIntervalMinutes
    ) {
      const hours = Math.floor(currentMinutes / 60);
      const minutes = currentMinutes % 60;

      const startTime = `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:00`;
      const start = new Date(zonedDateTimeToUtcIso(date, startTime, BUSINESS_CONFIG.timezone));

      const end = new Date(start);
      end.setMinutes(end.getMinutes() + getBookingOccupiedMinutes({
        durationMinutes: serviceDurationMinutes,
        isProcedure: serviceIsProcedure ?? false,
      }));

      if (end > windowEnd) {
        continue;
      }

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
        label: getTimeLabelInTimeZone(start.toISOString(), BUSINESS_CONFIG.timezone),
      });
    }
  }

  return slots;
}

export function getDayRange(date: string) {
  return getDayRangeIso(date, BUSINESS_CONFIG.timezone);
}

