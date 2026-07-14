DO $$ BEGIN
  CREATE TYPE "AccessRole" AS ENUM ('ADMIN', 'BARBER');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TYPE "BookingStatus" ADD VALUE IF NOT EXISTS 'CONCLUIDO';
ALTER TYPE "BookingStatus" ADD VALUE IF NOT EXISTS 'AUSENTE';

ALTER TABLE "AdminAccess"
  ADD COLUMN IF NOT EXISTS "role" "AccessRole" NOT NULL DEFAULT 'ADMIN',
  ADD COLUMN IF NOT EXISTS "barberId" TEXT;

UPDATE "AdminAccess" SET "role" = 'ADMIN' WHERE "role" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "AdminAccess_barberId_key" ON "AdminAccess"("barberId");
CREATE INDEX IF NOT EXISTS "AdminAccess_role_isActive_idx" ON "AdminAccess"("role", "isActive");

DO $$ BEGIN
  ALTER TABLE "AdminAccess"
    ADD CONSTRAINT "AdminAccess_barberId_fkey"
    FOREIGN KEY ("barberId") REFERENCES "Barber"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
