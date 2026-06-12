CREATE TYPE "ClientStatus" AS ENUM ('PENDING', 'ACTIVE');
CREATE TYPE "ClientCreatedBy" AS ENUM ('BARBER', 'CLIENT');
CREATE TYPE "BookingCreatedBy" AS ENUM ('BARBER', 'CLIENT');

ALTER TABLE "Client"
  ALTER COLUMN "passwordHash" DROP NOT NULL,
  ADD COLUMN "hasPassword" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "status" "ClientStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "createdBy" "ClientCreatedBy" NOT NULL DEFAULT 'CLIENT',
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "Booking"
  ADD COLUMN "clientId" TEXT,
  ADD COLUMN "observations" TEXT,
  ADD COLUMN "confirmationToken" TEXT,
  ADD COLUMN "confirmationTokenExpiresAt" TIMESTAMP(3),
  ADD COLUMN "confirmationTokenUsedAt" TIMESTAMP(3),
  ADD COLUMN "createdBy" "BookingCreatedBy" NOT NULL DEFAULT 'CLIENT';

CREATE UNIQUE INDEX "Booking_confirmationToken_key" ON "Booking"("confirmationToken");
CREATE INDEX "Booking_clientId_idx" ON "Booking"("clientId");
CREATE INDEX "Booking_confirmationToken_idx" ON "Booking"("confirmationToken");

ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
