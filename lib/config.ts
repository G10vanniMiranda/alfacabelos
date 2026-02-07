import { DailyOperatingConfig } from "@/types/domain";

export const BUSINESS_CONFIG = {
  slotIntervalMinutes: 30,
  bufferBetweenBookingsMinutes: 10,
  timezone: "America/Sao_Paulo",
  operatingHours: [
    { dayOfWeek: 1, open: "09:00", close: "19:00" },
    { dayOfWeek: 2, open: "09:00", close: "19:00" },
    { dayOfWeek: 3, open: "09:00", close: "19:00" },
    { dayOfWeek: 4, open: "09:00", close: "19:00" },
    { dayOfWeek: 5, open: "09:00", close: "19:00" },
    { dayOfWeek: 6, open: "09:00", close: "19:00" },
  ] satisfies DailyOperatingConfig[],
};

