ALTER TABLE "Service"
ADD COLUMN "isProcedure" BOOLEAN NOT NULL DEFAULT false;

-- Preserve custom long-running services as procedures during the rollout.
UPDATE "Service"
SET "isProcedure" = true
WHERE "durationMinutes" > 50;

-- The standard Corte + Barba service follows the one-hour chair block.
UPDATE "Service"
SET "durationMinutes" = 50,
    "isProcedure" = false
WHERE "id" = 'service-combo';

ALTER TABLE "Service"
ADD CONSTRAINT "Service_standard_duration_check"
CHECK ("isProcedure" OR "durationMinutes" <= 50);

ALTER TABLE "BookingSeries" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "BookingSeries" FROM anon;
REVOKE ALL PRIVILEGES ON TABLE "BookingSeries" FROM authenticated;
