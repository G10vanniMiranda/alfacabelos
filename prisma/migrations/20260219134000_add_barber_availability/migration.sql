CREATE TABLE "BarberAvailability" (
  "id" TEXT NOT NULL,
  "barberId" TEXT NOT NULL,
  "dayOfWeek" INTEGER NOT NULL,
  "openTime" TEXT NOT NULL,
  "closeTime" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "BarberAvailability_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BarberAvailability_barberId_dayOfWeek_openTime_closeTime_key" ON "BarberAvailability"("barberId", "dayOfWeek", "openTime", "closeTime");
CREATE INDEX "BarberAvailability_barberId_idx" ON "BarberAvailability"("barberId");

ALTER TABLE "BarberAvailability"
ADD CONSTRAINT "BarberAvailability_barberId_fkey"
FOREIGN KEY ("barberId") REFERENCES "Barber"("id") ON DELETE CASCADE ON UPDATE CASCADE;
