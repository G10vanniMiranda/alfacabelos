import { randomBytes, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { BUSINESS_CONFIG } from "@/lib/config";
import { isClosedDayAvailability } from "@/lib/constants/availability";
import { expandRecurrenceRule, weekdayForDate, type RecurrenceRule } from "@/lib/recurrence";
import { getBookingOccupiedMinutes, mergeOperatingWindows } from "@/lib/scheduling-rules";
import { getLocalDateInput, getTimeLabelInTimeZone, overlaps, zonedDateTimeToUtcIso } from "@/lib/utils";
import type { BookingCreatedBy, RecurrenceFrequency, SeriesMutationScope } from "@/types/domain";
import { sha256 } from "@/lib/security";

export type CreateBookingSeriesInput = {
  serviceId: string;
  barberId: string;
  clientId?: string;
  customerName: string;
  customerPhone: string;
  observations?: string;
  start: string;
  recurrence: "NONE" | RecurrenceFrequency;
  repeatUntil?: string;
  interval?: number;
  weekdays?: number[];
  idempotencyKey?: string;
  createdBy: BookingCreatedBy;
  requireConfirmation?: boolean;
};

export type BookingSeriesCreationResult = {
  seriesId?: string;
  bookingIds: string[];
  rawConfirmationTokens: Map<string, string>;
  duplicate: boolean;
};

type Occurrence = { localDate: string; start: Date; end: Date; index: number };

function toDateOnly(date: string) {
  return new Date(`${date}T00:00:00.000Z`);
}

function recurrenceRuleFromInput(input: CreateBookingSeriesInput): RecurrenceRule | null {
  if (input.recurrence === "NONE") return null;
  const startsOn = getLocalDateInput(input.start, BUSINESS_CONFIG.timezone);
  if (!input.repeatUntil) throw new Error("Informe até quando repetir");
  return {
    frequency: input.recurrence,
    startsOn,
    endsOn: input.repeatUntil,
    interval: input.interval ?? 1,
    weekdays: input.recurrence === "WEEKLY" ? (input.weekdays?.length ? input.weekdays : [weekdayForDate(startsOn)]) : [],
  };
}

function makeOccurrences(
  input: CreateBookingSeriesInput,
  service: { durationMinutes: number; isProcedure: boolean },
): Occurrence[] {
  const firstDate = getLocalDateInput(input.start, BUSINESS_CONFIG.timezone);
  const localTime = getTimeLabelInTimeZone(input.start, BUSINESS_CONFIG.timezone);
  const rule = recurrenceRuleFromInput(input);
  const dates = rule ? expandRecurrenceRule(rule) : [firstDate];
  if (dates[0] !== firstDate) throw new Error("A primeira ocorrência não corresponde ao início informado");
  return dates.map((localDate, index) => {
    const start = new Date(zonedDateTimeToUtcIso(localDate, `${localTime}:00`, BUSINESS_CONFIG.timezone));
    const end = new Date(start.getTime() + getBookingOccupiedMinutes(service) * 60_000);
    return { localDate, start, end, index };
  });
}

async function existingResult(idempotencyKey: string, requestHash: string, requireConfirmation = false): Promise<BookingSeriesCreationResult | null> {
  const existing = await prisma.bookingSeries.findUnique({
    where: { idempotencyKey },
    include: { bookings: { orderBy: { occurrenceIndex: "asc" }, select: { id: true, status: true } } },
  });
  if (!existing) return null;
  if (existing.requestHash !== requestHash) throw new Error("Chave de idempotência reutilizada com dados diferentes");
  const rawConfirmationTokens = new Map<string, string>();
  if (requireConfirmation) {
    for (const booking of existing.bookings) {
      if (booking.status !== "PENDENTE") continue;
      const delivery = await prisma.notificationDelivery.findUnique({ where: { idempotencyKey: `booking:${booking.id}:client-created` }, select: { id: true } });
      if (delivery) continue;
      const rawToken = randomBytes(32).toString("base64url");
      await prisma.booking.update({ where: { id: booking.id }, data: {
        confirmationTokenHash: sha256(rawToken), confirmationTokenExpiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      } });
      rawConfirmationTokens.set(booking.id, rawToken);
    }
  }
  return { seriesId: existing.id, bookingIds: existing.bookings.map((item) => item.id), rawConfirmationTokens, duplicate: true };
}

function validateAgainstOperatingHours(
  occurrence: Occurrence,
  availabilityRows: Array<{ dayOfWeek: number; openTime: string; closeTime: string }>,
) {
  const weekday = weekdayForDate(occurrence.localDate);
  const savedForDay = availabilityRows.filter((row) => row.dayOfWeek === weekday);
  const ranges = mergeOperatingWindows(savedForDay.length
    ? savedForDay.filter((row) => !isClosedDayAvailability(row)).map((row) => ({ open: row.openTime, close: row.closeTime }))
    : BUSINESS_CONFIG.operatingHours.filter((row) => row.dayOfWeek === weekday).map((row) => ({ open: row.open, close: row.close })));
  const startMinutes = Number(getTimeLabelInTimeZone(occurrence.start.toISOString(), BUSINESS_CONFIG.timezone).slice(0, 2)) * 60
    + Number(getTimeLabelInTimeZone(occurrence.start.toISOString(), BUSINESS_CONFIG.timezone).slice(3));
  const endMinutes = startMinutes + Math.round((occurrence.end.getTime() - occurrence.start.getTime()) / 60_000);
  const fits = ranges.some((range) => {
    const [openH, openM] = range.open.split(":").map(Number);
    const [closeH, closeM] = range.close.split(":").map(Number);
    const openMinutes = openH * 60 + openM;
    return startMinutes >= openMinutes && endMinutes <= closeH * 60 + closeM
      && (startMinutes - openMinutes) % BUSINESS_CONFIG.slotIntervalMinutes === 0;
  });
  if (!fits) throw new Error(`Horário fora do expediente em ${occurrence.localDate}`);
  if (occurrence.start < new Date()) throw new Error(`Não é possível agendar no passado: ${occurrence.localDate}`);
}

export async function createBookingSeriesAtomic(input: CreateBookingSeriesInput): Promise<BookingSeriesCreationResult> {
  const idempotencyKey = input.idempotencyKey?.trim() || (input.recurrence === "NONE" ? randomUUID() : "");
  if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 128) {
    throw new Error("Chave de idempotência obrigatória para recorrência");
  }
  const requestHash = sha256(JSON.stringify({
    serviceId: input.serviceId, barberId: input.barberId, clientId: input.clientId ?? null,
    customerName: input.customerName.trim(), customerPhone: input.customerPhone.replace(/\D/g, ""),
    observations: input.observations?.trim() || null, start: new Date(input.start).toISOString(),
    recurrence: input.recurrence, repeatUntil: input.repeatUntil ?? null, interval: input.interval ?? 1,
    weekdays: [...(input.weekdays ?? [])].sort((a, b) => a - b), createdBy: input.createdBy,
  }));
  const duplicate = await existingResult(idempotencyKey, requestHash, input.requireConfirmation);
  if (duplicate) return duplicate;

  try {
    return await prisma.$transaction(async (tx) => {
      const raced = await tx.bookingSeries.findUnique({ where: { idempotencyKey }, select: { id: true } });
      if (raced) throw new Error("SERIES_IDEMPOTENCY_RACE");

      const [service, barber, availabilityRows] = await Promise.all([
        tx.service.findFirst({ where: { id: input.serviceId, isActive: true } }),
        tx.barber.findFirst({ where: { id: input.barberId, isActive: true } }),
        tx.barberAvailability.findMany({ where: { barberId: input.barberId } }),
      ]);
      if (!service) throw new Error("Serviço não encontrado ou inativo");
      if (!barber) throw new Error("Barbeiro não encontrado ou inativo");

      const occurrences = makeOccurrences(input, service);
      for (const occurrence of occurrences) validateAgainstOperatingHours(occurrence, availabilityRows);
      const rangeStart = occurrences[0]!.start;
      const rangeEnd = occurrences[occurrences.length - 1]!.end;
      const [bookings, blocks] = await Promise.all([
        tx.booking.findMany({
          where: {
            barberId: input.barberId,
            status: { not: "CANCELADO" },
            dateTimeStart: { lt: rangeEnd },
            dateTimeEnd: { gt: rangeStart },
          },
          select: { id: true, dateTimeStart: true, dateTimeEnd: true },
        }),
        tx.blockedSlot.findMany({
          where: {
            AND: [
              { OR: [{ barberId: null }, { barberId: input.barberId }] },
              { dateTimeStart: { lt: rangeEnd } },
              { dateTimeEnd: { gt: rangeStart } },
            ],
          },
          select: { dateTimeStart: true, dateTimeEnd: true, reason: true },
        }),
      ]);

      for (const occurrence of occurrences) {
        const conflict = bookings.find((booking) => overlaps(occurrence.start, occurrence.end, booking.dateTimeStart, booking.dateTimeEnd));
        if (conflict) throw new Error(`Conflito com agendamento existente em ${occurrence.localDate}`);
        const block = blocks.find((item) => overlaps(occurrence.start, occurrence.end, item.dateTimeStart, item.dateTimeEnd));
        if (block) throw new Error(`Horário bloqueado em ${occurrence.localDate}: ${block.reason}`);
      }

      const rule = recurrenceRuleFromInput(input);
      const localTime = getTimeLabelInTimeZone(input.start, BUSINESS_CONFIG.timezone);
      const series = rule ? await tx.bookingSeries.create({
        data: {
          barberId: input.barberId,
          serviceId: input.serviceId,
          clientId: input.clientId,
          customerName: input.customerName,
          customerPhone: input.customerPhone,
          observations: input.observations?.trim() || null,
          frequency: rule.frequency,
          interval: rule.interval ?? 1,
          weekdays: rule.weekdays ?? [],
          localTime,
          timezone: BUSINESS_CONFIG.timezone,
          startsOn: toDateOnly(rule.startsOn),
          endsOn: toDateOnly(rule.endsOn),
          idempotencyKey,
          requestHash,
          createdBy: input.createdBy,
        },
      }) : null;

      const rawConfirmationTokens = new Map<string, string>();
      const bookingIds: string[] = [];
      for (const occurrence of occurrences) {
        const id = randomUUID();
        bookingIds.push(id);
        const rawToken = input.requireConfirmation ? randomBytes(32).toString("base64url") : undefined;
        if (rawToken) rawConfirmationTokens.set(id, rawToken);
        await tx.booking.create({
          data: {
            id,
            barberId: input.barberId,
            serviceId: input.serviceId,
            clientId: input.clientId,
            customerName: input.customerName,
            customerPhone: input.customerPhone,
            observations: input.observations?.trim() || null,
            dateTimeStart: occurrence.start,
            dateTimeEnd: occurrence.end,
            status: "PENDENTE",
            createdBy: input.createdBy,
            confirmationTokenHash: rawToken ? sha256(rawToken) : null,
            confirmationTokenExpiresAt: rawToken ? new Date(Date.now() + 48 * 60 * 60 * 1000) : null,
            seriesId: series?.id,
            occurrenceIndex: series ? occurrence.index : null,
            occurrenceLocalDate: series ? toDateOnly(occurrence.localDate) : null,
          },
        });
      }
      return { seriesId: series?.id, bookingIds, rawConfirmationTokens, duplicate: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (
      (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2002" || error.code === "P2034")) ||
      (error instanceof Error && error.message === "SERIES_IDEMPOTENCY_RACE")
    ) {
      const found = await existingResult(idempotencyKey, requestHash, input.requireConfirmation);
      if (found) return found;
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
        throw new Error("A agenda mudou durante a reserva. Tente novamente.");
      }
    }
    throw error;
  }
}

export async function previewBookingSeries(input: CreateBookingSeriesInput) {
  const [service, barber, availabilityRows] = await Promise.all([
    prisma.service.findFirst({ where: { id: input.serviceId, isActive: true } }),
    prisma.barber.findFirst({ where: { id: input.barberId, isActive: true } }),
    prisma.barberAvailability.findMany({ where: { barberId: input.barberId } }),
  ]);
  if (!service) throw new Error("Serviço não encontrado ou inativo");
  if (!barber) throw new Error("Barbeiro não encontrado ou inativo");
  const occurrences = makeOccurrences(input, service);
  const rangeStart = occurrences[0]!.start;
  const rangeEnd = occurrences[occurrences.length - 1]!.end;
  const [bookings, blocks] = await Promise.all([
    prisma.booking.findMany({
      where: { barberId: input.barberId, status: { not: "CANCELADO" }, dateTimeStart: { lt: rangeEnd }, dateTimeEnd: { gt: rangeStart } },
      select: { dateTimeStart: true, dateTimeEnd: true },
    }),
    prisma.blockedSlot.findMany({
      where: { AND: [
        { OR: [{ barberId: null }, { barberId: input.barberId }] },
        { dateTimeStart: { lt: rangeEnd } }, { dateTimeEnd: { gt: rangeStart } },
      ] },
      select: { dateTimeStart: true, dateTimeEnd: true, reason: true },
    }),
  ]);
  return occurrences.map((occurrence) => {
    try {
      validateAgainstOperatingHours(occurrence, availabilityRows);
      if (bookings.some((item) => overlaps(occurrence.start, occurrence.end, item.dateTimeStart, item.dateTimeEnd))) {
        throw new Error("Conflito com agendamento existente");
      }
      const block = blocks.find((item) => overlaps(occurrence.start, occurrence.end, item.dateTimeStart, item.dateTimeEnd));
      if (block) throw new Error(`Horário bloqueado: ${block.reason}`);
      return { localDate: occurrence.localDate, start: occurrence.start.toISOString(), end: occurrence.end.toISOString(), available: true as const };
    } catch (error) {
      return { localDate: occurrence.localDate, start: occurrence.start.toISOString(), end: occurrence.end.toISOString(), available: false as const, reason: error instanceof Error ? error.message : "Indisponível" };
    }
  });
}

export async function cancelBookingSeries(input: { bookingId: string; scope: SeriesMutationScope; clientId?: string }) {
  const booking = await prisma.booking.findUnique({ where: { id: input.bookingId }, select: { id: true, clientId: true, seriesId: true, dateTimeStart: true, occurrenceIndex: true } });
  if (!booking || (input.clientId && booking.clientId !== input.clientId)) throw new Error("Agendamento não encontrado");
  if (input.scope !== "SINGLE" && !booking.seriesId) throw new Error("Este agendamento não pertence a uma série");
  const where = input.scope === "SINGLE"
    ? { id: booking.id }
    : input.scope === "FUTURE"
      ? { seriesId: booking.seriesId!, dateTimeStart: { gte: booking.dateTimeStart } }
      : { seriesId: booking.seriesId! };
  return prisma.$transaction(async (tx) => {
    const affected = await tx.booking.findMany({ where: { ...where, status: { not: "CANCELADO" } }, select: { id: true } });
    const result = await tx.booking.updateMany({ where: { ...where, status: { not: "CANCELADO" } }, data: { status: "CANCELADO" } });
    if (booking.seriesId && input.scope === "ALL") {
      await tx.bookingSeries.update({ where: { id: booking.seriesId }, data: { status: "CANCELLED" } });
    } else if (booking.seriesId && input.scope === "FUTURE") {
      const series = await tx.bookingSeries.findUnique({ where: { id: booking.seriesId } });
      if (series && booking.occurrenceIndex === 0) {
        await tx.bookingSeries.update({ where: { id: booking.seriesId }, data: { status: "CANCELLED" } });
      } else if (series) {
        const previous = new Date(booking.dateTimeStart);
        previous.setUTCDate(previous.getUTCDate() - 1);
        await tx.bookingSeries.update({ where: { id: booking.seriesId }, data: { endsOn: toDateOnly(getLocalDateInput(previous.toISOString(), BUSINESS_CONFIG.timezone)) } });
      }
    }
    return { count: result.count, bookingIds: affected.map((item) => item.id), seriesId: booking.seriesId ?? undefined };
  });
}

export async function updateBookingSeriesOccurrences(input: {
  bookingId: string;
  scope: SeriesMutationScope;
  serviceId: string;
  barberId: string;
  customerName: string;
  customerPhone: string;
  observations?: string;
  start: string;
}) {
  return prisma.$transaction(async (tx) => {
    const target = await tx.booking.findUnique({ where: { id: input.bookingId } });
    if (!target) throw new Error("Agendamento não encontrado");
    if (input.scope !== "SINGLE" && !target.seriesId) throw new Error("Este agendamento não pertence a uma série");
    const service = await tx.service.findFirst({ where: { id: input.serviceId, isActive: true } });
    const barber = await tx.barber.findFirst({ where: { id: input.barberId, isActive: true } });
    if (!service) throw new Error("Serviço não encontrado ou inativo");
    if (!barber) throw new Error("Barbeiro não encontrado ou inativo");

    const allSeriesBookings = input.scope === "SINGLE" ? [] : await tx.booking.findMany({
        where: {
          seriesId: target.seriesId!,
          status: { not: "CANCELADO" },
        },
        orderBy: { dateTimeStart: "asc" },
      });
    const selected = input.scope === "SINGLE" ? [target] : input.scope === "FUTURE"
      ? allSeriesBookings.filter((item) => item.dateTimeStart >= target.dateTimeStart)
      : allSeriesBookings;
    const effectiveScope: SeriesMutationScope = input.scope === "FUTURE" && selected.length === allSeriesBookings.length ? "ALL" : input.scope;
    if (selected.length === 0) throw new Error("Nenhuma ocorrência ativa encontrada");
    const requestedStart = new Date(input.start);
    if (Number.isNaN(requestedStart.getTime())) throw new Error("Data/hora inválida");
    const delta = requestedStart.getTime() - target.dateTimeStart.getTime();
    const occurrences = selected.map((booking, index) => {
      const start = new Date(booking.dateTimeStart.getTime() + delta);
      const end = new Date(start.getTime() + getBookingOccupiedMinutes(service) * 60_000);
      return { localDate: getLocalDateInput(start.toISOString(), BUSINESS_CONFIG.timezone), start, end, index };
    });
    const availabilityRows = await tx.barberAvailability.findMany({ where: { barberId: input.barberId } });
    for (const occurrence of occurrences) validateAgainstOperatingHours(occurrence, availabilityRows);
    const selectedIds = selected.map((booking) => booking.id);
    const rangeStart = occurrences[0]!.start;
    const rangeEnd = occurrences[occurrences.length - 1]!.end;
    const [conflicts, blocks] = await Promise.all([
      tx.booking.findMany({
        where: {
          id: { notIn: selectedIds }, barberId: input.barberId, status: { not: "CANCELADO" },
          dateTimeStart: { lt: rangeEnd }, dateTimeEnd: { gt: rangeStart },
        },
        select: { dateTimeStart: true, dateTimeEnd: true },
      }),
      tx.blockedSlot.findMany({
        where: { AND: [
          { OR: [{ barberId: null }, { barberId: input.barberId }] },
          { dateTimeStart: { lt: rangeEnd } }, { dateTimeEnd: { gt: rangeStart } },
        ] },
        select: { dateTimeStart: true, dateTimeEnd: true, reason: true },
      }),
    ]);
    for (const occurrence of occurrences) {
      if (conflicts.some((item) => overlaps(occurrence.start, occurrence.end, item.dateTimeStart, item.dateTimeEnd))) {
        throw new Error(`Conflito com agendamento existente em ${occurrence.localDate}`);
      }
      const block = blocks.find((item) => overlaps(occurrence.start, occurrence.end, item.dateTimeStart, item.dateTimeEnd));
      if (block) throw new Error(`Horário bloqueado em ${occurrence.localDate}: ${block.reason}`);
    }

    let destinationSeriesId = target.seriesId;
    if (target.seriesId && effectiveScope === "FUTURE") {
      const source = await tx.bookingSeries.findUnique({ where: { id: target.seriesId } });
      if (!source) throw new Error("Série não encontrada");
      const first = occurrences[0]!.localDate;
      const last = occurrences[occurrences.length - 1]!.localDate;
      const destination = await tx.bookingSeries.create({
        data: {
          barberId: input.barberId, serviceId: input.serviceId, clientId: source.clientId,
          customerName: input.customerName, customerPhone: input.customerPhone,
          observations: input.observations?.trim() || null, frequency: source.frequency,
          interval: source.interval,
          weekdays: source.frequency === "WEEKLY" ? [...new Set(occurrences.map((item) => weekdayForDate(item.localDate)))] : source.weekdays,
          localTime: getTimeLabelInTimeZone(occurrences[0]!.start.toISOString(), BUSINESS_CONFIG.timezone),
          timezone: source.timezone, startsOn: toDateOnly(first), endsOn: toDateOnly(last),
          conflictPolicy: source.conflictPolicy, idempotencyKey: randomUUID(), requestHash: randomUUID(), createdBy: source.createdBy,
        },
      });
      destinationSeriesId = destination.id;
      const previousEnd = new Date(target.dateTimeStart);
      previousEnd.setUTCDate(previousEnd.getUTCDate() - 1);
      await tx.bookingSeries.update({ where: { id: source.id }, data: { endsOn: toDateOnly(getLocalDateInput(previousEnd.toISOString(), BUSINESS_CONFIG.timezone)) } });
    }

    await tx.booking.updateMany({
      where: { id: { in: selectedIds } },
      data: { seriesId: null, occurrenceIndex: null, occurrenceLocalDate: null },
    });
    for (let index = 0; index < selected.length; index += 1) {
      const booking = selected[index]!;
      const occurrence = occurrences[index]!;
      await tx.booking.update({
        where: { id: booking.id },
        data: {
          barberId: input.barberId, serviceId: input.serviceId, customerName: input.customerName,
          customerPhone: input.customerPhone, observations: input.observations?.trim() || null,
          dateTimeStart: occurrence.start, dateTimeEnd: occurrence.end,
          seriesId: effectiveScope === "SINGLE" ? null : destinationSeriesId,
          occurrenceIndex: effectiveScope === "SINGLE" ? null : index,
          occurrenceLocalDate: effectiveScope === "SINGLE" ? null : toDateOnly(occurrence.localDate),
        },
      });
    }
    if (target.seriesId && effectiveScope === "ALL") {
      await tx.bookingSeries.update({
        where: { id: target.seriesId },
        data: {
          barberId: input.barberId, serviceId: input.serviceId, customerName: input.customerName,
          customerPhone: input.customerPhone, observations: input.observations?.trim() || null,
          localTime: getTimeLabelInTimeZone(occurrences[0]!.start.toISOString(), BUSINESS_CONFIG.timezone),
          startsOn: toDateOnly(occurrences[0]!.localDate), endsOn: toDateOnly(occurrences[occurrences.length - 1]!.localDate),
          weekdays: [...new Set(occurrences.map((item) => weekdayForDate(item.localDate)))],
        },
      });
    }
    return { bookingIds: selectedIds, seriesId: destinationSeriesId ?? undefined };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function detachOccurrenceFromSeries(bookingId: string) {
  return prisma.booking.update({
    where: { id: bookingId },
    data: { seriesId: null, occurrenceIndex: null, occurrenceLocalDate: null },
  });
}
