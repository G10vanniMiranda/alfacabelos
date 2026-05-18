export const CLOSED_DAY_TIME = "00:00";

export function isClosedDayAvailability(range: { openTime: string; closeTime: string }) {
  return range.openTime === CLOSED_DAY_TIME && range.closeTime === CLOSED_DAY_TIME;
}

export function isClosedOperatingWindow(range: { open: string; close: string }) {
  return range.open === CLOSED_DAY_TIME && range.close === CLOSED_DAY_TIME;
}
