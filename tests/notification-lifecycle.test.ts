import assert from "node:assert/strict";
import { test } from "node:test";
import type { NotificationEvent } from "@prisma/client";
import {
  BOOKING_CREATED_NOTICE_MAX_AGE_MS,
  checkNotificationValidity,
  evaluateNotificationValidity,
  notificationValidityUpperBound,
  passwordResetTokenHashFromKey,
  reminderSchedule,
  type NotificationValidityReferences,
} from "../lib/notifications/validity-policy";
import { zonedDateTimeToUtcIso } from "../lib/utils";

const now = new Date("2026-10-10T12:00:00.000Z");
const hour = 60 * 60_000;
const tokenHash = "a".repeat(64);
const env = {} as NodeJS.ProcessEnv;
const envWith = (values: Record<string, string>) => values as unknown as NodeJS.ProcessEnv;

function booking(overrides: Partial<NonNullable<NotificationValidityReferences["booking"]>> = {}) {
  return {
    status: "PENDENTE" as const,
    dateTimeStart: new Date(now.getTime() + 20 * hour),
    confirmationTokenHash: null,
    confirmationTokenExpiresAt: null,
    confirmationTokenUsedAt: null,
    ...overrides,
  };
}

function subject(event: NotificationEvent, idempotencyKey: string, createdAt = new Date(now.getTime() - hour), bookingId: string | null = "booking-1") {
  return { event, idempotencyKey, bookingId, createdAt };
}

function reminderKey(start: Date) {
  return `booking:booking-1:client:booking_reminder:${start.toISOString()}`;
}

const staffKey = "booking:booking-1:client:booking_created_by_staff";
const ownerKey = "booking:booking-1:owner:booking_created_by_client";

test("password reset: valid token is deliverable until it expires", () => {
  const expiresAt = new Date(now.getTime() + 10 * 60_000);
  const result = evaluateNotificationValidity(
    subject("PASSWORD_RESET", `password-reset:${tokenHash}`, now, null),
    { booking: null, passwordResetToken: { expiresAt, usedAt: null } }, now, env,
  );
  assert.deepEqual(result, { outcome: "VALID", validUntil: expiresAt });
});

test("password reset: expired, consumed and unverifiable tokens fail closed as INVALID", () => {
  const key = `password-reset:${tokenHash}`;
  const resetSubject = subject("PASSWORD_RESET", key, now, null);
  assert.deepEqual(
    evaluateNotificationValidity(resetSubject, { booking: null, passwordResetToken: { expiresAt: now, usedAt: null } }, now, env),
    { outcome: "INVALID", classification: "EXPIRED", reason: "reset_token_expired" },
  );
  assert.deepEqual(
    evaluateNotificationValidity(resetSubject, { booking: null, passwordResetToken: { expiresAt: new Date(now.getTime() + hour), usedAt: now } }, now, env),
    { outcome: "INVALID", classification: "EXPIRED", reason: "reset_token_used" },
  );
  assert.deepEqual(
    evaluateNotificationValidity(resetSubject, { booking: null, passwordResetToken: null }, now, env),
    { outcome: "INVALID", classification: "INVALID_REFERENCE", reason: "reset_token_missing" },
  );
  assert.deepEqual(
    evaluateNotificationValidity(subject("PASSWORD_RESET", "qa:legacy-key", now, null), { booking: null, passwordResetToken: { expiresAt: new Date(now.getTime() + hour), usedAt: null } }, now, env),
    { outcome: "INVALID", classification: "INVALID_REFERENCE", reason: "reset_reference_missing" },
  );
});

test("password reset key parsing only accepts a sha256 hex hash", () => {
  assert.equal(passwordResetTokenHashFromKey(`password-reset:${tokenHash}`), tokenHash);
  assert.equal(passwordResetTokenHashFromKey(`password-reset:${tokenHash.toUpperCase()}`), null);
  assert.equal(passwordResetTokenHashFromKey(`password-reset:${tokenHash}:extra`), null);
  assert.equal(passwordResetTokenHashFromKey("password-reset:short"), null);
});

test("reminder: a future reminder is valid until the minimum lead before start", () => {
  const start = new Date(now.getTime() + 20 * hour);
  const result = evaluateNotificationValidity(
    subject("BOOKING_REMINDER", reminderKey(start)), { booking: booking({ dateTimeStart: start }), passwordResetToken: null }, now, env,
  );
  assert.deepEqual(result, { outcome: "VALID", validUntil: new Date(start.getTime() - hour) });
});

test("reminder: past booking, cancellation, closure, reschedule and closed window are INVALID", () => {
  const past = new Date(now.getTime() - hour);
  const check = (references: NotificationValidityReferences, key: string) =>
    evaluateNotificationValidity(subject("BOOKING_REMINDER", key), references, now, env);

  assert.deepEqual(check({ booking: booking({ dateTimeStart: past }), passwordResetToken: null }, reminderKey(past)),
    { outcome: "INVALID", classification: "EXPIRED", reason: "booking_started" });
  assert.deepEqual(check({ booking: booking({ dateTimeStart: now }), passwordResetToken: null }, reminderKey(now)),
    { outcome: "INVALID", classification: "EXPIRED", reason: "booking_started" });

  const future = new Date(now.getTime() + 20 * hour);
  assert.deepEqual(check({ booking: booking({ dateTimeStart: future, status: "CANCELADO" }), passwordResetToken: null }, reminderKey(future)),
    { outcome: "INVALID", classification: "CANCELED", reason: "booking_cancelled" });
  assert.deepEqual(check({ booking: booking({ dateTimeStart: future, status: "AUSENTE" }), passwordResetToken: null }, reminderKey(future)),
    { outcome: "INVALID", classification: "EXPIRED", reason: "booking_closed" });
  assert.deepEqual(check({ booking: booking({ dateTimeStart: new Date(future.getTime() + hour) }), passwordResetToken: null }, reminderKey(future)),
    { outcome: "INVALID", classification: "INVALID_REFERENCE", reason: "booking_rescheduled" });
  assert.deepEqual(check({ booking: booking({ dateTimeStart: future }), passwordResetToken: null }, "booking:booking-1:client:booking_reminder"),
    { outcome: "INVALID", classification: "INVALID_REFERENCE", reason: "reminder_reference_missing" });
  assert.deepEqual(check({ booking: null, passwordResetToken: null }, reminderKey(future)),
    { outcome: "INVALID", classification: "INVALID_REFERENCE", reason: "booking_missing" });

  const soon = new Date(now.getTime() + 30 * 60_000);
  assert.deepEqual(check({ booking: booking({ dateTimeStart: soon }), passwordResetToken: null }, reminderKey(soon)),
    { outcome: "INVALID", classification: "EXPIRED", reason: "reminder_window_closed" });
});

test("reminder: comparison uses absolute UTC instants, not the notification creation time", () => {
  // 09:00 in America/Sao_Paulo (UTC-3) persisted as 12:00Z.
  const start = new Date(zonedDateTimeToUtcIso("2026-10-11", "09:00", "America/Sao_Paulo"));
  assert.equal(start.toISOString(), "2026-10-11T12:00:00.000Z");
  const createdLongAgo = new Date(now.getTime() - 7 * 24 * hour);
  const result = evaluateNotificationValidity(
    subject("BOOKING_REMINDER", reminderKey(start), createdLongAgo), { booking: booking({ dateTimeStart: start }), passwordResetToken: null }, now, env,
  );
  assert.equal(result.outcome, "VALID");
});

test("creation notices are valid for 6 hours after creation", () => {
  assert.equal(BOOKING_CREATED_NOTICE_MAX_AGE_MS, 6 * hour);
  const references = { booking: booking({ dateTimeStart: new Date(now.getTime() + 5 * 24 * hour) }), passwordResetToken: null };
  for (const [event, key] of [["BOOKING_CREATED_BY_STAFF", staffKey], ["BOOKING_CREATED_BY_CLIENT", ownerKey]] as const) {
    const createdFiveHoursAgo = new Date(now.getTime() - 5 * hour);
    assert.deepEqual(evaluateNotificationValidity(subject(event, key, createdFiveHoursAgo), references, now, env),
      { outcome: "VALID", validUntil: new Date(createdFiveHoursAgo.getTime() + 6 * hour) });
    assert.deepEqual(evaluateNotificationValidity(subject(event, key, new Date(now.getTime() - 7 * hour)), references, now, env),
      { outcome: "INVALID", classification: "EXPIRED", reason: "notice_too_old" });
    assert.deepEqual(evaluateNotificationValidity(subject(event, key, new Date(now.getTime() - 6 * hour)), references, now, env),
      { outcome: "INVALID", classification: "EXPIRED", reason: "notice_too_old" });
  }
});

test("creation notices still require an existing, active, future booking", () => {
  const fresh = new Date(now.getTime() - hour);
  for (const [event, key] of [["BOOKING_CREATED_BY_STAFF", staffKey], ["BOOKING_CREATED_BY_CLIENT", ownerKey]] as const) {
    assert.deepEqual(evaluateNotificationValidity(subject(event, key, fresh), { booking: null, passwordResetToken: null }, now, env),
      { outcome: "INVALID", classification: "INVALID_REFERENCE", reason: "booking_missing" });
    assert.deepEqual(evaluateNotificationValidity(subject(event, key, fresh), { booking: booking({ status: "CANCELADO" }), passwordResetToken: null }, now, env),
      { outcome: "INVALID", classification: "CANCELED", reason: "booking_cancelled" });
    assert.deepEqual(evaluateNotificationValidity(subject(event, key, fresh), { booking: booking({ dateTimeStart: now }), passwordResetToken: null }, now, env),
      { outcome: "INVALID", classification: "EXPIRED", reason: "booking_started" });
  }
  // A booking starting before the 6h notice window closes bounds validity by its start.
  const soon = new Date(now.getTime() + 2 * hour);
  assert.deepEqual(evaluateNotificationValidity(subject("BOOKING_CREATED_BY_CLIENT", ownerKey, fresh), { booking: booking({ dateTimeStart: soon }), passwordResetToken: null }, now, env),
    { outcome: "VALID", validUntil: soon });
});

test("staff notice with a confirmation link follows the (unchanged 48h) confirmation token", () => {
  const tokenExpiresAt = new Date(now.getTime() + 2 * hour);
  const withToken = (overrides: Partial<NonNullable<NotificationValidityReferences["booking"]>>) => ({
    booking: booking({ confirmationTokenHash: "hash", confirmationTokenExpiresAt: tokenExpiresAt, ...overrides }), passwordResetToken: null,
  });
  assert.deepEqual(evaluateNotificationValidity(subject("BOOKING_CREATED_BY_STAFF", staffKey), withToken({}), now, env),
    { outcome: "VALID", validUntil: tokenExpiresAt });
  // Future booking, fresh notice, but the confirmation link has already expired.
  assert.deepEqual(evaluateNotificationValidity(subject("BOOKING_CREATED_BY_STAFF", staffKey), withToken({ confirmationTokenExpiresAt: now }), now, env),
    { outcome: "INVALID", classification: "EXPIRED", reason: "confirmation_token_expired" });
  assert.deepEqual(evaluateNotificationValidity(subject("BOOKING_CREATED_BY_STAFF", staffKey), withToken({ status: "CONFIRMADO", confirmationTokenUsedAt: now }), now, env),
    { outcome: "INVALID", classification: "EXPIRED", reason: "confirmation_resolved" });
});

test("cancellation and reschedule notices keep their current rules", () => {
  const start = new Date(now.getTime() + 3 * hour);
  assert.deepEqual(evaluateNotificationValidity(
    subject("BOOKING_CANCELLED", "booking:booking-1:client:booking_cancelled"),
    { booking: booking({ dateTimeStart: start, status: "CANCELADO" }), passwordResetToken: null }, now, env,
  ), { outcome: "VALID", validUntil: start });
  assert.deepEqual(evaluateNotificationValidity(
    subject("BOOKING_CANCELLED", "booking:booking-1:client:booking_cancelled"),
    { booking: booking({ dateTimeStart: start, status: "PENDENTE" }), passwordResetToken: null }, now, env,
  ), { outcome: "INVALID", classification: "INVALID_REFERENCE", reason: "booking_not_cancelled" });

  const rescheduledKey = `booking:booking-1:client:booking_rescheduled:${start.toISOString()}`;
  assert.deepEqual(evaluateNotificationValidity(
    subject("BOOKING_RESCHEDULED", rescheduledKey), { booking: booking({ dateTimeStart: start }), passwordResetToken: null }, now, env,
  ), { outcome: "VALID", validUntil: start });
  assert.deepEqual(evaluateNotificationValidity(
    subject("BOOKING_RESCHEDULED", rescheduledKey), { booking: booking({ dateTimeStart: new Date(start.getTime() + hour) }), passwordResetToken: null }, now, env,
  ), { outcome: "INVALID", classification: "INVALID_REFERENCE", reason: "booking_rescheduled_again" });
});

test("an event without an explicit policy is UNSUPPORTED_EVENT, never valid", () => {
  const result = evaluateNotificationValidity(
    subject("SOMETHING_NEW" as NotificationEvent, "x"), { booking: booking(), passwordResetToken: null }, now, env,
  );
  assert.deepEqual(result, { outcome: "UNSUPPORTED_EVENT", reason: "event_policy_missing" });
});

test("a failed reference lookup is TEMPORARILY_UNVERIFIABLE, not INVALID and not VALID", async () => {
  const failing = {
    booking: { findUnique: async () => { throw new Error("Can't reach database server"); } },
    passwordResetToken: { findUnique: async () => { throw new Error("Can't reach database server"); } },
  } as unknown as Parameters<typeof checkNotificationValidity>[0];
  for (const item of [
    subject("BOOKING_REMINDER", reminderKey(new Date(now.getTime() + 20 * hour))),
    subject("PASSWORD_RESET", `password-reset:${tokenHash}`, now, null),
  ]) {
    assert.deepEqual(await checkNotificationValidity(failing, item, now), { outcome: "TEMPORARILY_UNVERIFIABLE", reason: "validity_lookup_failed" });
  }
});

test("validity upper bound is derived from the outbox row alone", () => {
  const createdAt = new Date(now.getTime() - hour);
  assert.deepEqual(notificationValidityUpperBound(subject("PASSWORD_RESET", `password-reset:${tokenHash}`, createdAt, null), env),
    new Date(createdAt.getTime() + 30 * 60_000));
  assert.deepEqual(notificationValidityUpperBound(subject("BOOKING_CREATED_BY_STAFF", staffKey, createdAt), env),
    new Date(createdAt.getTime() + 6 * hour));
  const start = new Date(now.getTime() + 20 * hour);
  assert.deepEqual(notificationValidityUpperBound(subject("BOOKING_REMINDER", reminderKey(start)), env), new Date(start.getTime() - hour));
  assert.deepEqual(notificationValidityUpperBound(subject("BOOKING_RESCHEDULED", `booking:booking-1:client:booking_rescheduled:${start.toISOString()}`), env), start);
  assert.equal(notificationValidityUpperBound(subject("BOOKING_CANCELLED", "booking:booking-1:client:booking_cancelled"), env), null);
});

test("reminder schedule keeps the minimum lead inside the enqueue window", () => {
  assert.deepEqual(reminderSchedule(env), { leadMinutes: 1440, windowMinutes: 10, minLeadMinutes: 60 });
  assert.deepEqual(reminderSchedule(envWith({ NOTIFICATION_REMINDER_LEAD_MINUTES: "30", NOTIFICATION_REMINDER_WINDOW_MINUTES: "10" })),
    { leadMinutes: 30, windowMinutes: 10, minLeadMinutes: 20 });
  assert.deepEqual(reminderSchedule(envWith({ NOTIFICATION_REMINDER_MIN_LEAD_MINUTES: "-5" })).minLeadMinutes, 0);
  assert.deepEqual(reminderSchedule(envWith({ NOTIFICATION_REMINDER_MIN_LEAD_MINUTES: "abc" })).minLeadMinutes, 60);
});
