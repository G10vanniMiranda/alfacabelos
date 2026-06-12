CREATE TABLE "PasswordResetToken" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SecurityRateLimitEvent" (
  "id" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "identifierHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SecurityRateLimitEvent_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Booking" ADD COLUMN "confirmationTokenHash" TEXT;

CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");
CREATE INDEX "PasswordResetToken_clientId_idx" ON "PasswordResetToken"("clientId");
CREATE INDEX "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt");
CREATE INDEX "SecurityRateLimitEvent_scope_identifierHash_createdAt_idx" ON "SecurityRateLimitEvent"("scope", "identifierHash", "createdAt");
CREATE UNIQUE INDEX "Booking_confirmationTokenHash_key" ON "Booking"("confirmationTokenHash");
CREATE INDEX "Booking_confirmationTokenHash_idx" ON "Booking"("confirmationTokenHash");

ALTER TABLE "PasswordResetToken"
  ADD CONSTRAINT "PasswordResetToken_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
