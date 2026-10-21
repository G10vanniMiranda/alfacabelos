---
name: alfa-supabase-safety
description: Audit or change ALFA-CABELOS Supabase/PostgreSQL schema, migrations, RLS, grants, Storage, service-role use, parity, and environment isolation safely.
---

# ALFA-CABELOS Supabase production safety

Read [security-phase-1.md](../../../docs/security-phase-1.md) for the access model, [backup-restore-runbook.md](../../../docs/backup-restore-runbook.md) for recovery constraints, and the current production-readiness report before remote work.

## Access model

The app uses opaque application sessions and Prisma server-side. `anon` and `authenticated` are not application data-access roles. Keep RLS enabled and deny public access unless the architecture is explicitly changed. Keep service-role credentials server-only; never expose them through `NEXT_PUBLIC_*`, logs, generated output, or client bundles.

Treat RLS and grants as separate controls. Review tables, sequences, functions, views, default privileges, policies, Storage policies, and `SECURITY DEFINER` functions. Do not solve permission errors by widening `PUBLIC`, `anon`, or `authenticated` access.

## Environment gate

Before any database or Storage write, identify the project ref, organization, region, database host/name, application environment, Vercel target, bucket, and whether secrets/resources are shared with production. Values of secrets must not be printed.

Remote writes are blocked when the target is ambiguous, shared, production, or lacks explicit authorization. `ALLOW_DESTRUCTIVE_TESTS=true` is not proof of safety. Tests that seed, migrate, upload, delete, restore, or clean fixtures require a local disposable target accepted by `npm run environment:guard`, or an explicitly authorized isolated homologation target.

## Migration workflow

Review existing order and drift; create forward-only SQL with a unique timestamp; inspect destructive operations, locks, RLS/grants, backfill cost, and rollback strategy. Validate with `npx prisma validate`, `npm run check:migrations`, a PostgreSQL 16 database reconstructed from zero, relevant tests, and catalog/parity queries. Use `EXPLAIN (ANALYZE, BUFFERS)` only on disposable or authorized homologation data.

Never apply remote migrations as part of review or diagnosis. Production application requires verified backup/PITR, a change window, human approval, homologation evidence, and a compensating or restore plan.

## Storage

Database backups do not restore Storage objects. Validate MIME, magic bytes, size, path containment, bucket policy, and server-only service-role usage. Remote upload/delete tests require an isolated bucket and explicit approval; preserve unrelated buckets and policies.

Report local parity, homologation parity, and production parity independently as `PASS`, `FAIL`, or `UNKNOWN` with dated evidence.

