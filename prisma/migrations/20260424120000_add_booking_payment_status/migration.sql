CREATE TYPE "BookingPaymentStatus" AS ENUM ('PENDENTE', 'CONFIRMADO');

ALTER TABLE "Booking"
ADD COLUMN "paymentStatus" "BookingPaymentStatus" NOT NULL DEFAULT 'PENDENTE',
ADD COLUMN "paymentConfirmedAt" TIMESTAMP(3);

CREATE INDEX "Booking_paymentStatus_idx" ON "Booking"("paymentStatus");
