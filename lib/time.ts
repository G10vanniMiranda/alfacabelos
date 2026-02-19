import { BUSINESS_CONFIG } from "@/lib/config";
import { getDayRangeIso, getTimeLabel, overlaps, toMinutes } from "@/lib/utils";
import { AvailableSlot } from "@/types/scheduler";
import { BlockedSlot, Booking, DailyOperatingConfig } from "@/types/domain";

function mergeDailyWindows(windows: DailyOperatingConfig[]): DailyOperatingConfig[] {
  const sorted = [...windows].sort((a, b) => a.open.localeCompare(b.open));
  if (sorted.length === 0) {
    return [];
  }

  const merged: DailyOperatingConfig[] = [{ ...sorted[0] }];

  for (let i = 1; i < sorted.length; i += 1) {
    const current = sorted[i];
    const last = merged[merged.length - 1];
    if (!current || !last) {
      continue;
    }

    // Join contiguous or overlapping ranges (e.g. 09:00-10:00 + 10:00-11:00 => 09:00-11:00).
    if (current.open <= last.close) {
      if (current.close > last.close) {
        last.close = current.close;
      }
      continue;
    }

    merged.push({ ...current });
  }

  return merged;
}

export function generateAvailableSlots(params: {
  date: string;
  barberId: string;
  serviceDurationMinutes: number;
  barberBookings: Booking[];
  blockedSlots: BlockedSlot[];
  operatingHours?: DailyOperatingConfig[];
}): AvailableSlot[] {
  const { date, barberId, serviceDurationMinutes, barberBookings, blockedSlots, operatingHours } = params;
  const day = new Date(`${date}T12:00:00`).getDay();
  const windows = mergeDailyWindows(
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

    for (
      let currentMinutes = startMinutes;
      currentMinutes < endMinutes;
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
  }

  return slots;
}

export function getDayRange(date: string) {
  return getDayRangeIso(date);
}

