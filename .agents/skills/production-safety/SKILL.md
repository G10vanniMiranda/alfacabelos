---
name: production-safety
description: Use before any action that could mutate production, a shared remote environment, or an environment whose identity is ambiguous.
---

# Production safety

Loading this skill does not authorize a remote write, deployment, message, migration, deletion, or secret change.

## Classify the target

Classify it as `LOCAL_DISPOSABLE`, `ISOLATED_HOMOLOGATION`, `PRODUCTION`, or `SHARED_OR_AMBIGUOUS`.

Before a mutation, prove the exact environment, project or reference, host, database or bucket, provider or recipient, artifact, expected effect, and rollback path. Environment variable names and a local `.env` file are not proof of remote identity.

## Decision gate

1. Prefer read-only inspection and sanitized metadata.
2. Allow local disposable mutations within the requested scope.
3. For isolated homologation, require proven target identity, bounded impact, rollback, and current explicit authorization.
4. Treat `SHARED_OR_AMBIGUOUS` as production until identity is proven.
5. For production, also require the applicable domain procedure, `alfa-release-gate`, current human approval for the exact action, and verified backup or rollback where relevant.
6. Stop if any prerequisite is missing. Report the missing proof; do not guess or silently switch targets.

Use `alfa-supabase-safety` for database, storage, RLS, grant, or migration actions. Use `alfa-evolution-operations` for WhatsApp or Evolution actions. Use `alfa-change-verification` and `verification-before-completion` after authorized work.

Never expose secrets or PII in commands, logs, screenshots, or reports. Never use a real customer recipient for a test unless that exact send is explicitly authorized.
