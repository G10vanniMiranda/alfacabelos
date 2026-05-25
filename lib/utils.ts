export function formatBRLFromCents(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value / 100);
}

export function toMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

export function addMinutesToIso(iso: string, minutes: number): string {
  const date = new Date(iso);
  date.setMinutes(date.getMinutes() + minutes);
  return date.toISOString();
}

export function overlaps(startA: Date, endA: Date, startB: Date, endB: Date): boolean {
  return startA < endB && endA > startB;
}

export function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }
  return phone;
}

export function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

export function formatDateInput(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function getZonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour === "24" ? "00" : values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = getZonedParts(date, timeZone);
  const zonedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return zonedAsUtc - date.getTime();
}

export function zonedDateTimeToUtcIso(dateInput: string, timeInput: string, timeZone: string): string {
  const [year, month, day] = dateInput.split("-").map(Number);
  const [hour = 0, minute = 0, second = 0] = timeInput.split(":").map(Number);
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let utcMs = localAsUtc - getTimeZoneOffsetMs(new Date(localAsUtc), timeZone);
  const adjustedOffset = getTimeZoneOffsetMs(new Date(utcMs), timeZone);
  utcMs = localAsUtc - adjustedOffset;
  return new Date(utcMs).toISOString();
}

export function getLocalDateInput(iso: string, timeZone?: string): string {
  if (timeZone) {
    const parts = getZonedParts(new Date(iso), timeZone);
    return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
  }

  return formatDateInput(new Date(iso));
}

export function getDayRangeIso(date: string, timeZone?: string): { start: string; end: string } {
  if (timeZone) {
    return {
      start: zonedDateTimeToUtcIso(date, "00:00:00", timeZone),
      end: zonedDateTimeToUtcIso(date, "23:59:59", timeZone),
    };
  }

  const startDate = new Date(`${date}T00:00:00`);
  const endDate = new Date(`${date}T23:59:59`);
  return { start: startDate.toISOString(), end: endDate.toISOString() };
}

export function getTimeLabel(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function getTimeLabelInTimeZone(iso: string, timeZone: string): string {
  const parts = getZonedParts(new Date(iso), timeZone);
  return `${pad2(parts.hour)}:${pad2(parts.minute)}`;
}

export function formatDateTimeInTimeZone(
  iso: string,
  timeZone: string,
  options: Intl.DateTimeFormatOptions = { dateStyle: "short", timeStyle: "short" },
): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    ...options,
  }).format(new Date(iso));
}

