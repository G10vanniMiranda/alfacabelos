export type SchedulerDraft = {
  serviceId?: string;
  barberId?: string;
  date?: string;
  time?: string;
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
};
