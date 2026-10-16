---
name: alfa-release-gate
description: Evaluate ALFA-CABELOS homologation, production readiness, Vercel cron/observability, CI, migration parity, external integrations, approval, and release gates.
---

# ALFA-CABELOS release gate

The release path is:

`development -> verification -> isolated homologation -> production readiness -> human approval -> release`

Loading this skill never authorizes commit, push, merge, deploy, migration, secret changes, plan changes, real messages, or data deletion.

## Evidence hierarchy

Use current executable evidence over historical reports. Read [production-readiness-phase-5.md](../../../docs/production-readiness-phase-5.md), [production-readiness-phase-6.md](../../../docs/production-readiness-phase-6.md), [operations.md](../../../docs/runbooks/operations.md), and [backup-restore-runbook.md](../../../docs/backup-restore-runbook.md). Reclassify each old blocker as `RESOLVED`, `PARTIALLY RESOLVED`, `STILL OPEN`, or `UNKNOWN`.

Do not infer remote state from local `.env`, code presence, a READY deployment, or a past report. Evidence must identify environment, target, commit/artifact, timestamp, and check result without revealing secrets.

## Hard gates

- Dependency audit and lockfile/CI install are green.
- Lint, TypeScript, Prisma validation, migration validation, tests, build, sensitive-file check, and whitespace check pass with skipped coverage disclosed.
- Supabase/Vercel/Storage/Evolution resources are isolated for homologation; preview/development do not share production secrets or data.
- Schema/migration parity, RLS, grants, default privileges, Storage policies, and readiness are verified on the intended target.
- Hosted CI is green for the exact candidate commit.
- Critical browser journeys and admin/RBAC flows pass on the candidate deployment.
- Cron authentication, invocation, heartbeat, retry/DEAD behavior, and plan compatibility are proven.
- WhatsApp is either an explicitly waived non-requirement or has one controlled authorized homologation proof with `providerMessageId` and no duplicate.
- External alert delivery is proven, not merely local detection/logging.
- Database backup/PITR evidence and separate Storage backup exist; restore was rehearsed in a new isolated target with measured RPO/RTO.
- A named human approves production promotion after reviewing evidence and rollback/cutover steps.

Any failed hard gate means `NOT READY`. Unknown evidence remains open; do not average it away with a score.

## Release execution boundary

Before an authorized release, restate exact project, environment, artifact/commit, database ref, migration set, expected external effects, rollback trigger, and approver. Stop if identifiers are ambiguous or resources are shared. After deployment, verify health/readiness, critical smoke flows, cron/worker, error logs, and rollback conditions before declaring success.

