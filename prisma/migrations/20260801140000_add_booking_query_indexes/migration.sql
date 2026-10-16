-- Phase 2: support bounded calendar reads, incremental polling and client history pagination.
-- Prepared only; do not apply directly to production without staging validation.

ALTER TABLE "Booking"
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS "Booking_clientId_dateTimeStart_idx"
  ON "Booking"("clientId", "dateTimeStart");

CREATE INDEX IF NOT EXISTS "Booking_dateTimeStart_idx"
  ON "Booking"("dateTimeStart");

CREATE INDEX IF NOT EXISTS "Booking_status_dateTimeStart_idx"
  ON "Booking"("status", "dateTimeStart");

CREATE INDEX IF NOT EXISTS "Booking_paymentStatus_dateTimeStart_idx"
  ON "Booking"("paymentStatus", "dateTimeStart");

CREATE INDEX IF NOT EXISTS "Booking_updatedAt_idx"
  ON "Booking"("updatedAt");

CREATE INDEX IF NOT EXISTS "BlockedSlot_barberId_dateTimeStart_dateTimeEnd_idx"
  ON "BlockedSlot"("barberId", "dateTimeStart", "dateTimeEnd");

DROP INDEX IF EXISTS "Booking_clientId_idx";
DROP INDEX IF EXISTS "Booking_status_idx";
DROP INDEX IF EXISTS "Booking_paymentStatus_idx";
