import { BUSINESS_CONFIG } from "@/lib/config";
import type { Service } from "@/types/domain";

export const STANDARD_BOOKING_BLOCK_MINUTES = 60;
export const STANDARD_SERVICE_MAX_MINUTES =
  STANDARD_BOOKING_BLOCK_MINUTES - BUSINESS_CONFIG.bufferBetweenBookingsMinutes;

export function getBookingOccupiedMinutes(
  service: Pick<Service, "durationMinutes" | "isProcedure">,
): number {
  if (!service.isProcedure) {
    return STANDARD_BOOKING_BLOCK_MINUTES;
  }

  return service.durationMinutes + BUSINESS_CONFIG.bufferBetweenBookingsMinutes;
}

export function mergeOperatingWindows<T extends { open: string; close: string }>(windows: T[]): T[] {
  const sorted = [...windows].sort((a, b) => a.open.localeCompare(b.open));
  if (sorted.length === 0) {
    return [];
  }

  const merged: T[] = [{ ...sorted[0] }];

  for (let index = 1; index < sorted.length; index += 1) {
    const current = sorted[index];
    const last = merged[merged.length - 1];
    if (!current || !last) {
      continue;
    }

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
