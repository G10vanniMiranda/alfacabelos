import type { BookingStatus, NotificationDelivery, NotificationEvent, Prisma } from "@prisma/client";
import { evaluatePasswordResetToken, PASSWORD_RESET_TOKEN_TTL_MINUTES } from "@/lib/auth/password-reset-security";

// Business validity is separate from claim eligibility: a row may be claimable
// (PENDING/RETRY, eligibleAt <= now) and still describe something that is no
// longer true or useful. This module decides, deterministically and without
// reading message content, whether a delivery may still reach the provider.
//
// Four outcomes, never fail-open:
//   VALID                     -> may be sent, until `validUntil`
//   INVALID                   -> proven invalid; retire permanently (DEAD)
//   UNSUPPORTED_EVENT         -> no policy exists for the event; retire (DEAD)
//   TEMPORARILY_UNVERIFIABLE  -> the references could not be read right now;
//                                do not send, retry later within limits
// The pure evaluator only returns the first three. TEMPORARILY_UNVERIFIABLE is
// produced by callers when loading the references fails.

export type NotificationInvalidClass = "EXPIRED" | "CANCELED" | "INVALID_REFERENCE";

export type NotificationValidity =
  | { outcome: "VALID"; validUntil: Date | null }
  | { outcome: "INVALID"; classification: NotificationInvalidClass; reason: string }
  | { outcome: "UNSUPPORTED_EVENT"; reason: "event_policy_missing" }
  | { outcome: "TEMPORARILY_UNVERIFIABLE"; reason: string };

export type NotificationValiditySubject = Pick<NotificationDelivery, "event" | "idempotencyKey" | "bookingId" | "createdAt">;

export type NotificationValidityReferences = {
  booking: {
    status: BookingStatus;
    dateTimeStart: Date;
    confirmationTokenHash: string | null;
    confirmationTokenExpiresAt: Date | null;
    confirmationTokenUsedAt: Date | null;
  } | null;
  passwordResetToken: { expiresAt: Date; usedAt: Date | null } | null;
};

/**
 * Creation notices (staff pre-booking confirmation and the owner's new-booking
 * notice) are only useful shortly after the booking is made: 6 hours after the
 * creation event. This is independent of the 48h confirmation token TTL, which
 * remains unchanged; a notice carrying a link also requires the link to be valid.
 */
export const BOOKING_CREATED_NOTICE_MAX_AGE_MS = 6 * 60 * 60_000;

const DEFAULT_REMINDER_LEAD_MINUTES = 24 * 60;
const DEFAULT_REMINDER_WINDOW_MINUTES = 10;
const DEFAULT_REMINDER_MIN_LEAD_MINUTES = 60;

export const LIFECYCLE_ERROR_CATEGORY = {
  EXPIRED: "lifecycle_expired",
  CANCELED: "lifecycle_canceled",
  INVALID_REFERENCE: "lifecycle_invalid_reference",
  UNSUPPORTED_EVENT: "lifecycle_unsupported_event",
  TEMPORARILY_UNVERIFIABLE: "lifecycle_unverifiable",
  UNVERIFIABLE_EXHAUSTED: "lifecycle_unverifiable_exhausted",
} as const;

export function reminderSchedule(env: NodeJS.ProcessEnv = process.env): {
  leadMinutes: number;
  windowMinutes: number;
  minLeadMinutes: number;
} {
  const configuredLead = Number(env.NOTIFICATION_REMINDER_LEAD_MINUTES ?? DEFAULT_REMINDER_LEAD_MINUTES);
  const configuredWindow = Number(env.NOTIFICATION_REMINDER_WINDOW_MINUTES ?? DEFAULT_REMINDER_WINDOW_MINUTES);
  const configuredMinLead = Number(env.NOTIFICATION_REMINDER_MIN_LEAD_MINUTES ?? DEFAULT_REMINDER_MIN_LEAD_MINUTES);
  const leadMinutes = Number.isFinite(configuredLead) ? Math.min(7 * 24 * 60, Math.max(15, configuredLead)) : DEFAULT_REMINDER_LEAD_MINUTES;
  const windowMinutes = Number.isFinite(configuredWindow) ? Math.min(60, Math.max(5, configuredWindow)) : DEFAULT_REMINDER_WINDOW_MINUTES;
  // A reminder enqueued at the earliest edge of the window must still be valid.
  const minLeadCeiling = Math.max(0, leadMinutes - windowMinutes);
  const minLeadMinutes = Number.isFinite(configuredMinLead)
    ? Math.min(minLeadCeiling, Math.max(0, Math.trunc(configuredMinLead)))
    : Math.min(minLeadCeiling, DEFAULT_REMINDER_MIN_LEAD_MINUTES);
  return { leadMinutes, windowMinutes, minLeadMinutes };
}

export function passwordResetTokenHashFromKey(idempotencyKey: string): string | null {
  return /^password-reset:([0-9a-f]{64})$/.exec(idempotencyKey)?.[1] ?? null;
}

function bookingStartFromKey(idempotencyKey: string, event: "booking_reminder" | "booking_rescheduled"): Date | null {
  const marker = `:${event}:`;
  const index = idempotencyKey.indexOf(marker);
  if (index < 0) return null;
  const iso = idempotencyKey.slice(index + marker.length);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(iso)) return null;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function earliest(...dates: Array<Date | null | undefined>): Date | null {
  const values = dates.filter((date): date is Date => date instanceof Date);
  return values.length ? new Date(Math.min(...values.map((date) => date.getTime()))) : null;
}

function invalid(classification: NotificationInvalidClass, reason: string): NotificationValidity {
  return { outcome: "INVALID", classification, reason };
}

function validUntil(deadline: Date | null, now: Date): NotificationValidity {
  if (deadline && deadline <= now) return invalid("EXPIRED", "validity_window_closed");
  return { outcome: "VALID", validUntil: deadline };
}

/**
 * Latest instant at which the delivery could still be valid, derived only from
 * the outbox row itself. Used when the references cannot be read, so retries
 * of an unverifiable delivery never outlive its maximum validity. `null` means
 * the row carries no bound (the attempt limit still applies).
 */
export function notificationValidityUpperBound(
  subject: NotificationValiditySubject,
  env: NodeJS.ProcessEnv = process.env,
): Date | null {
  switch (subject.event) {
    case "PASSWORD_RESET":
      // The token is created before the outbox row in the same transaction.
      return new Date(subject.createdAt.getTime() + PASSWORD_RESET_TOKEN_TTL_MINUTES * 60_000);
    case "BOOKING_CREATED_BY_STAFF":
    case "BOOKING_CREATED_BY_CLIENT":
      return new Date(subject.createdAt.getTime() + BOOKING_CREATED_NOTICE_MAX_AGE_MS);
    case "BOOKING_REMINDER": {
      const start = bookingStartFromKey(subject.idempotencyKey, "booking_reminder");
      return start ? new Date(start.getTime() - reminderSchedule(env).minLeadMinutes * 60_000) : null;
    }
    case "BOOKING_RESCHEDULED":
      return bookingStartFromKey(subject.idempotencyKey, "booking_rescheduled");
    default:
      return null;
  }
}

export function evaluateNotificationValidity(
  subject: NotificationValiditySubject,
  references: NotificationValidityReferences,
  now: Date,
  env: NodeJS.ProcessEnv = process.env,
): NotificationValidity {
  const event: NotificationEvent = subject.event;

  if (event === "PASSWORD_RESET") {
    // Fail closed: without a verifiable token row there is no proof the link works.
    if (!passwordResetTokenHashFromKey(subject.idempotencyKey)) return invalid("INVALID_REFERENCE", "reset_reference_missing");
    const status = evaluatePasswordResetToken(references.passwordResetToken, now);
    if (status === "invalid") return invalid("INVALID_REFERENCE", "reset_token_missing");
    if (status === "used") return invalid("EXPIRED", "reset_token_used");
    if (status === "expired") return invalid("EXPIRED", "reset_token_expired");
    return validUntil(references.passwordResetToken!.expiresAt, now);
  }

  if (
    event !== "BOOKING_REMINDER" && event !== "BOOKING_RESCHEDULED" && event !== "BOOKING_CANCELLED"
    && event !== "BOOKING_CREATED_BY_STAFF" && event !== "BOOKING_CREATED_BY_CLIENT"
  ) {
    return { outcome: "UNSUPPORTED_EVENT", reason: "event_policy_missing" };
  }

  const booking = references.booking;
  if (!subject.bookingId || !booking) return invalid("INVALID_REFERENCE", "booking_missing");
  const start = booking.dateTimeStart;

  if (event === "BOOKING_CANCELLED") {
    if (booking.status !== "CANCELADO") return invalid("INVALID_REFERENCE", "booking_not_cancelled");
    if (start <= now) return invalid("EXPIRED", "booking_started");
    return validUntil(start, now);
  }

  if (booking.status === "CANCELADO") return invalid("CANCELED", "booking_cancelled");
  if (booking.status === "CONCLUIDO" || booking.status === "AUSENTE") return invalid("EXPIRED", "booking_closed");
  if (start <= now) return invalid("EXPIRED", "booking_started");

  if (event === "BOOKING_REMINDER") {
    const remindedStart = bookingStartFromKey(subject.idempotencyKey, "booking_reminder");
    if (!remindedStart) return invalid("INVALID_REFERENCE", "reminder_reference_missing");
    if (remindedStart.getTime() !== start.getTime()) return invalid("INVALID_REFERENCE", "booking_rescheduled");
    const { minLeadMinutes } = reminderSchedule(env);
    const deadline = new Date(start.getTime() - minLeadMinutes * 60_000);
    if (deadline <= now) return invalid("EXPIRED", "reminder_window_closed");
    return validUntil(deadline, now);
  }

  if (event === "BOOKING_RESCHEDULED") {
    const rescheduledStart = bookingStartFromKey(subject.idempotencyKey, "booking_rescheduled");
    if (!rescheduledStart) return invalid("INVALID_REFERENCE", "reschedule_reference_missing");
    if (rescheduledStart.getTime() !== start.getTime()) return invalid("INVALID_REFERENCE", "booking_rescheduled_again");
    return validUntil(start, now);
  }

  // BOOKING_CREATED_BY_STAFF / BOOKING_CREATED_BY_CLIENT
  const noticeDeadline = new Date(subject.createdAt.getTime() + BOOKING_CREATED_NOTICE_MAX_AGE_MS);
  if (noticeDeadline <= now) return invalid("EXPIRED", "notice_too_old");
  if (event === "BOOKING_CREATED_BY_STAFF" && booking.confirmationTokenHash) {
    // The client message carries a confirmation link; it is pointless once the
    // link can no longer confirm the booking.
    if (booking.confirmationTokenUsedAt || booking.status !== "PENDENTE") return invalid("EXPIRED", "confirmation_resolved");
    if (!booking.confirmationTokenExpiresAt || booking.confirmationTokenExpiresAt <= now) {
      return invalid("EXPIRED", "confirmation_token_expired");
    }
    return validUntil(earliest(start, noticeDeadline, booking.confirmationTokenExpiresAt), now);
  }
  return validUntil(earliest(start, noticeDeadline), now);
}

type ValidityDb = Pick<Prisma.TransactionClient, "booking" | "passwordResetToken">;

export async function loadNotificationValidityReferences(
  db: ValidityDb,
  subject: NotificationValiditySubject,
): Promise<NotificationValidityReferences> {
  const tokenHash = subject.event === "PASSWORD_RESET" ? passwordResetTokenHashFromKey(subject.idempotencyKey) : null;
  const [booking, passwordResetToken] = await Promise.all([
    subject.bookingId && subject.event !== "PASSWORD_RESET"
      ? db.booking.findUnique({
        where: { id: subject.bookingId },
        select: {
          status: true, dateTimeStart: true, confirmationTokenHash: true,
          confirmationTokenExpiresAt: true, confirmationTokenUsedAt: true,
        },
      })
      : null,
    tokenHash
      ? db.passwordResetToken.findUnique({ where: { tokenHash }, select: { expiresAt: true, usedAt: true } })
      : null,
  ]);
  return { booking, passwordResetToken };
}

/**
 * Loads references and evaluates validity. A failure to read the references
 * (connection loss, timeout, pool exhaustion) is reported as
 * TEMPORARILY_UNVERIFIABLE rather than thrown, so callers never confuse
 * "could not check" with "checked and invalid".
 */
export async function checkNotificationValidity(
  db: ValidityDb,
  subject: NotificationValiditySubject,
  now = new Date(),
): Promise<NotificationValidity> {
  let references: NotificationValidityReferences;
  try {
    references = await loadNotificationValidityReferences(db, subject);
  } catch {
    return { outcome: "TEMPORARILY_UNVERIFIABLE", reason: "validity_lookup_failed" };
  }
  return evaluateNotificationValidity(subject, references, now);
}
