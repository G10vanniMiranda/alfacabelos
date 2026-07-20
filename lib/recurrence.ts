import type { RecurrenceFrequency } from "@/types/domain";

export const MAX_SERIES_OCCURRENCES = 59;

export type RecurrenceRule = {
  frequency: RecurrenceFrequency;
  startsOn: string;
  endsOn: string;
  interval?: number;
  weekdays?: number[];
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(date: string) {
  if (!DATE_RE.test(date)) throw new Error("Data da recorrencia invalida");
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day, 12));
  if (
    value.getUTCFullYear() !== year ||
    value.getUTCMonth() !== month - 1 ||
    value.getUTCDate() !== day
  ) {
    throw new Error("Data da recorrencia invalida");
  }
  return { year, month, day, value };
}

function formatDate(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0, 12)).getUTCDate();
}

function addDays(date: string, amount: number) {
  const { value } = parseDate(date);
  value.setUTCDate(value.getUTCDate() + amount);
  return formatDate(value);
}

function addMonthsFromOrigin(date: string, amount: number) {
  const { year, month, day } = parseDate(date);
  const monthIndex = month - 1 + amount;
  const targetYear = year + Math.floor(monthIndex / 12);
  const targetMonth = ((monthIndex % 12) + 12) % 12 + 1;
  const targetDay = Math.min(day, daysInMonth(targetYear, targetMonth));
  return `${targetYear}-${String(targetMonth).padStart(2, "0")}-${String(targetDay).padStart(2, "0")}`;
}

export function weekdayForDate(date: string) {
  return parseDate(date).value.getUTCDay();
}

export function expandRecurrenceRule(rule: RecurrenceRule, max = MAX_SERIES_OCCURRENCES): string[] {
  parseDate(rule.startsOn);
  parseDate(rule.endsOn);
  if (rule.endsOn < rule.startsOn) throw new Error("O periodo da recorrencia e invalido");
  const interval = rule.interval ?? 1;
  if (!Number.isInteger(interval) || interval < 1 || interval > 52) {
    throw new Error("Intervalo da recorrencia invalido");
  }

  const dates: string[] = [];
  if (rule.frequency === "DAILY") {
    for (let step = 0; ; step += 1) {
      const date = addDays(rule.startsOn, step * interval);
      if (date > rule.endsOn) break;
      dates.push(date);
      if (dates.length > max) throw new Error(`Limite de ${max} ocorrencias por serie excedido`);
    }
  } else if (rule.frequency === "WEEKLY") {
    const weekdays = [...new Set(rule.weekdays?.length ? rule.weekdays : [weekdayForDate(rule.startsOn)])]
      .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
      .sort((a, b) => a - b);
    if (weekdays.length === 0) throw new Error("Informe ao menos um dia da semana");
    let cursor = rule.startsOn;
    let offset = 0;
    while (cursor <= rule.endsOn) {
      const week = Math.floor(offset / 7);
      if (week % interval === 0 && weekdays.includes(weekdayForDate(cursor))) dates.push(cursor);
      if (dates.length > max) throw new Error(`Limite de ${max} ocorrencias por serie excedido`);
      offset += 1;
      cursor = addDays(rule.startsOn, offset);
    }
  } else {
    for (let step = 0; ; step += 1) {
      const date = addMonthsFromOrigin(rule.startsOn, step * interval);
      if (date > rule.endsOn) break;
      dates.push(date);
      if (dates.length > max) throw new Error(`Limite de ${max} ocorrencias por serie excedido`);
    }
  }

  if (dates.length === 0) throw new Error("A recorrencia nao gerou nenhuma ocorrencia");
  return dates;
}

