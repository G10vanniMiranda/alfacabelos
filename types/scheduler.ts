export type SchedulerDraft = {
  serviceId?: string;
  barberId?: string;
  date?: string;
  time?: string;
  recurrence?: "NONE" | "DAILY" | "WEEKLY" | "MONTHLY";
  repeatUntil?: string;
  recurrenceKey?: string;
  customerName?: string;
  customerPhone?: string;
};

export type AvailableSlot = {
  start: string;
  end: string;
  label: string;
};

export type ActionState = {
  success: boolean;
  message: string;
  bookingId?: string;
  code?: "PASSWORD_SETUP_REQUIRED";
};
