DO $$ BEGIN
  CREATE TYPE "NotificationStatus" AS ENUM ('NOT_CONFIGURED', 'PENDING', 'SENDING', 'SENT', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "NotificationEvent" AS ENUM ('BOOKING_CREATED_BY_CLIENT', 'BOOKING_CREATED_BY_STAFF', 'BOOKING_RESCHEDULED', 'BOOKING_CANCELLED', 'BOOKING_REMINDER', 'PASSWORD_RESET');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "NotificationDelivery" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "event" "NotificationEvent" NOT NULL,
  "channel" TEXT NOT NULL DEFAULT 'WHATSAPP',
  "recipient" TEXT NOT NULL,
  "recipientMasked" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "context" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "nextRetryAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "bookingId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NotificationDelivery_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "NotificationDelivery_idempotencyKey_key" ON "NotificationDelivery"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "NotificationDelivery_status_nextRetryAt_idx" ON "NotificationDelivery"("status", "nextRetryAt");
CREATE INDEX IF NOT EXISTS "NotificationDelivery_bookingId_event_idx" ON "NotificationDelivery"("bookingId", "event");
ALTER TABLE "NotificationDelivery" ENABLE ROW LEVEL SECURITY;
