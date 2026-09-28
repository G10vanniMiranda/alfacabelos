BEGIN;

CREATE TYPE "NotificationStatus_v2" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'RETRY', 'DEAD');

ALTER TABLE "NotificationDelivery" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "NotificationDelivery" ALTER COLUMN "status" TYPE "NotificationStatus_v2"
USING (
  CASE "status"::TEXT
    WHEN 'SENT' THEN 'SENT'
    ELSE 'DEAD'
  END
)::"NotificationStatus_v2";
DROP TYPE "NotificationStatus";
ALTER TYPE "NotificationStatus_v2" RENAME TO "NotificationStatus";
ALTER TABLE "NotificationDelivery" ALTER COLUMN "status" SET DEFAULT 'PENDING';

ALTER TABLE "NotificationDelivery"
  ADD COLUMN IF NOT EXISTS "seriesId" TEXT,
  ADD COLUMN IF NOT EXISTS "lockedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lockedBy" TEXT,
  ADD COLUMN IF NOT EXISTS "processedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "providerMessageId" TEXT,
  ADD COLUMN IF NOT EXISTS "errorCategory" TEXT,
  ADD COLUMN IF NOT EXISTS "eligibleAt" TIMESTAMP(3);

-- Existing unsent rows predate the explicit delivery authorization marker.
-- Keep them quarantined until a specific, audited replay authorizes delivery.
UPDATE "NotificationDelivery"
SET "eligibleAt" = NULL,
    "nextRetryAt" = NULL,
    "lockedAt" = NULL,
    "lockedBy" = NULL,
    "processedAt" = CASE
      WHEN "status" = 'DEAD' THEN COALESCE("processedAt", CURRENT_TIMESTAMP)
      ELSE "processedAt"
    END;

UPDATE "NotificationDelivery"
SET "errorCategory" = 'legacy_quarantined'
WHERE "status" = 'DEAD';

DROP INDEX IF EXISTS "NotificationDelivery_status_nextRetryAt_idx";
CREATE INDEX IF NOT EXISTS "NotificationDelivery_status_eligibleAt_nextRetryAt_createdAt_idx"
  ON "NotificationDelivery"("status", "eligibleAt", "nextRetryAt", "createdAt");
CREATE INDEX IF NOT EXISTS "NotificationDelivery_lockedAt_idx" ON "NotificationDelivery"("lockedAt");
CREATE INDEX IF NOT EXISTS "NotificationDelivery_seriesId_event_idx" ON "NotificationDelivery"("seriesId", "event");

DO $$ BEGIN
  ALTER TABLE "NotificationDelivery"
    ADD CONSTRAINT "NotificationDelivery_seriesId_fkey"
    FOREIGN KEY ("seriesId") REFERENCES "BookingSeries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;
