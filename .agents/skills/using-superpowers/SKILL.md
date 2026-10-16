---
name: using-superpowers
description: Use when starting ALFA-CABELOS work that may have an established skill, safety boundary, or verification procedure.
---

# Using project skills

Read `alfa-task-routing` first when the task is a bug, feature, security review, migration, WhatsApp operation, browser regression, homologation, or release.

Select the smallest useful set:

1. Load the relevant process or domain skill before acting.
2. Add `test-driven-development` only for testable behavior changes.
3. Add `verification-before-completion` before any completion claim.
4. Load `alfa-release-gate` only for release or readiness work.

Loading a skill does not authorize remote writes, messages, migrations, deploys, secret changes, data deletion, or production access.

Do not load every skill defensively. For ordinary documentation or read-only analysis, use only the procedure that materially changes the work.
