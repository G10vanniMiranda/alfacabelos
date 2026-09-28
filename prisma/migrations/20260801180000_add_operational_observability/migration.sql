BEGIN;

ALTER TABLE "NotificationDelivery"
  ADD COLUMN IF NOT EXISTS "requestId" TEXT,
  ADD COLUMN IF NOT EXISTS "replayCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "lastReplayedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "NotificationDelivery_requestId_idx"
  ON "NotificationDelivery"("requestId");

CREATE TABLE IF NOT EXISTS "OperationalHeartbeat" (
  "worker" TEXT NOT NULL PRIMARY KEY,
  "status" TEXT NOT NULL,
  "lastRunAt" TIMESTAMP(3) NOT NULL,
  "lastSuccessAt" TIMESTAMP(3),
  "lastFailureAt" TIMESTAMP(3),
  "durationMs" INTEGER,
  "processedCount" INTEGER NOT NULL DEFAULT 0,
  "lastErrorCode" TEXT,
  "metadata" JSONB,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "OperationalHeartbeat_lastSuccessAt_idx"
  ON "OperationalHeartbeat"("lastSuccessAt");
CREATE INDEX IF NOT EXISTS "OperationalHeartbeat_status_lastRunAt_idx"
  ON "OperationalHeartbeat"("status", "lastRunAt");

CREATE TABLE IF NOT EXISTS "AuditLog" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "actorType" TEXT NOT NULL,
  "actorId" TEXT,
  "action" TEXT NOT NULL,
  "resourceType" TEXT NOT NULL,
  "resourceId" TEXT,
  "metadata" JSONB,
  "requestId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "AuditLog_resourceType_resourceId_createdAt_idx"
  ON "AuditLog"("resourceType", "resourceId", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_actorId_createdAt_idx"
  ON "AuditLog"("actorId", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_action_createdAt_idx"
  ON "AuditLog"("action", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_requestId_idx" ON "AuditLog"("requestId");
CREATE INDEX IF NOT EXISTS "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

ALTER TABLE "OperationalHeartbeat" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "OperationalHeartbeat" FROM anon, authenticated;
REVOKE ALL ON TABLE "AuditLog" FROM anon, authenticated;

CREATE OR REPLACE FUNCTION "prevent_audit_log_mutation"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog is append-only';
END;
$$;

REVOKE ALL ON FUNCTION "prevent_audit_log_mutation"() FROM PUBLIC;

DROP TRIGGER IF EXISTS "AuditLog_append_only" ON "AuditLog";
CREATE TRIGGER "AuditLog_append_only"
BEFORE UPDATE OR DELETE ON "AuditLog"
FOR EACH ROW EXECUTE FUNCTION "prevent_audit_log_mutation"();

COMMIT;
