import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { isDeliveryEligibleForClaim } from "../lib/notifications/service";

const migrationPath = new URL(
  "../prisma/migrations/20260801160000_harden_notification_outbox/migration.sql",
  import.meta.url,
);
const migrationSql = readFileSync(migrationPath, "utf8");
const observabilityMigrationSql = readFileSync(new URL(
  "../prisma/migrations/20260801180000_add_operational_observability/migration.sql",
  import.meta.url,
), "utf8");

function legacyStatusTarget(status: string): string | undefined {
  const explicit = new RegExp(`WHEN\\s+'${status}'\\s+THEN\\s+'([^']+)'`, "i").exec(migrationSql)?.[1];
  if (explicit) return explicit.toUpperCase();
  return /ELSE\s+'DEAD'/i.test(migrationSql) ? "DEAD" : undefined;
}

test("migration quarantines every pre-migration unsent status and preserves SENT", () => {
  assert.equal(legacyStatusTarget("SENT"), "SENT");
  for (const status of ["PENDING", "FAILED", "NOT_CONFIGURED", "SENDING"]) {
    assert.equal(legacyStatusTarget(status), "DEAD", `${status} must be quarantined as DEAD`);
  }
  assert.doesNotMatch(migrationSql, /WHEN\s+'(?:FAILED|NOT_CONFIGURED|SENDING)'\s+THEN\s+'RETRY'/i);
});

test("migration adds nullable eligibleAt without a database default", () => {
  const column = /ADD COLUMN IF NOT EXISTS\s+"eligibleAt"\s+([^,;]+)/i.exec(migrationSql)?.[1] ?? "";
  assert.match(column, /TIMESTAMP\(3\)/i);
  assert.doesNotMatch(column, /NOT NULL|DEFAULT/i);
});

test("migration is explicitly transactional on PostgreSQL", () => {
  assert.match(migrationSql, /^\s*BEGIN\s*;/i);
  assert.match(migrationSql, /COMMIT\s*;\s*$/i);
});

test("operational observability migration is one explicit transaction", () => {
  assert.match(observabilityMigrationSql, /^\s*BEGIN\s*;/i);
  assert.match(observabilityMigrationSql, /ALTER TABLE "NotificationDelivery"/i);
  assert.match(observabilityMigrationSql, /CREATE TABLE IF NOT EXISTS "OperationalHeartbeat"/i);
  assert.match(observabilityMigrationSql, /CREATE TABLE IF NOT EXISTS "AuditLog"/i);
  assert.match(observabilityMigrationSql, /ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY/i);
  assert.match(observabilityMigrationSql, /CREATE OR REPLACE FUNCTION "prevent_audit_log_mutation"/i);
  assert.match(observabilityMigrationSql, /CREATE TRIGGER "AuditLog_append_only"[\s\S]*?COMMIT\s*;\s*$/i);
});

test("historical rows cannot become eligible solely because of migration", () => {
  assert.match(migrationSql, /"eligibleAt"\s*=\s*NULL/i);
  assert.match(migrationSql, /"errorCategory"\s*=\s*'legacy_quarantined'/i);
});

test("the migrated legacy dataset yields zero worker claims", () => {
  const now = new Date("2026-09-26T12:00:00.000Z");
  const legacyStatuses = ["SENT", "PENDING", "FAILED", "NOT_CONFIGURED", "SENDING"];
  const eligible = legacyStatuses.filter((legacyStatus) => isDeliveryEligibleForClaim({
    status: legacyStatusTarget(legacyStatus) as "PENDING" | "PROCESSING" | "SENT" | "RETRY" | "DEAD",
    attempts: 0,
    eligibleAt: null,
    nextRetryAt: null,
    lockedAt: null,
    lockedBy: null,
  }, now, 8));

  assert.deepEqual(eligible, []);
});
