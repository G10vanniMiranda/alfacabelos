-- Add a persisted recurrence domain without changing existing standalone bookings.
CREATE TYPE "RecurrenceFrequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');
CREATE TYPE "BookingSeriesStatus" AS ENUM ('ACTIVE', 'CANCELLED');
CREATE TYPE "RecurrenceConflictPolicy" AS ENUM ('REJECT_ALL');

CREATE TABLE "BookingSeries" (
    "id" TEXT NOT NULL,
    "barberId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "clientId" TEXT,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "observations" TEXT,
    "frequency" "RecurrenceFrequency" NOT NULL,
    "interval" INTEGER NOT NULL DEFAULT 1,
    "weekdays" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
    "localTime" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE NOT NULL,
    "status" "BookingSeriesStatus" NOT NULL DEFAULT 'ACTIVE',
    "conflictPolicy" "RecurrenceConflictPolicy" NOT NULL DEFAULT 'REJECT_ALL',
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "createdBy" "BookingCreatedBy" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BookingSeries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "BookingSeries_interval_check" CHECK ("interval" > 0),
    CONSTRAINT "BookingSeries_period_check" CHECK ("endsOn" >= "startsOn")
);

ALTER TABLE "Booking"
  ADD COLUMN "seriesId" TEXT,
  ADD COLUMN "occurrenceIndex" INTEGER,
  ADD COLUMN "occurrenceLocalDate" DATE;

CREATE UNIQUE INDEX "BookingSeries_idempotencyKey_key" ON "BookingSeries"("idempotencyKey");
CREATE INDEX "BookingSeries_barberId_startsOn_endsOn_idx" ON "BookingSeries"("barberId", "startsOn", "endsOn");
CREATE INDEX "BookingSeries_clientId_idx" ON "BookingSeries"("clientId");
CREATE INDEX "BookingSeries_status_idx" ON "BookingSeries"("status");
CREATE INDEX "Booking_seriesId_idx" ON "Booking"("seriesId");
CREATE UNIQUE INDEX "Booking_seriesId_occurrenceLocalDate_key" ON "Booking"("seriesId", "occurrenceLocalDate");

ALTER TABLE "BookingSeries" ADD CONSTRAINT "BookingSeries_barberId_fkey" FOREIGN KEY ("barberId") REFERENCES "Barber"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BookingSeries" ADD CONSTRAINT "BookingSeries_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BookingSeries" ADD CONSTRAINT "BookingSeries_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "BookingSeries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
