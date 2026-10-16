---
name: alfa-change-verification
description: Diagnose, implement, and verify ALFA-CABELOS bugs and code changes with evidence, regression tests, safe environment guards, and claim verification.
---

# ALFA-CABELOS change verification

## Diagnose before changing

1. Reproduce or identify the first broken boundary with logs, code paths, tests, or a minimal deterministic check.
2. Distinguish root cause from symptoms and record the evidence that supports the diagnosis.
3. For a bug, add or identify a failing regression test before the fix when the behavior can be isolated without unsafe external effects.
4. Make the smallest coherent change. Preserve unrelated worktree changes.

Do not use test-driven development mechanically for documentation, generated artifacts, configuration inventory, or behavior that cannot be tested safely. In those cases, state the observable invariant and verify it directly.

## Verification ladder

Run the narrowest relevant checks first, then broaden in proportion to risk:

- targeted unit or contract test;
- `npm run lint` and `npx tsc --noEmit`;
- `npx prisma validate` and `npm run check:migrations` for schema work;
- `npm test`;
- integration tests only after `npm run environment:guard` accepts a local disposable database;
- browser/E2E checks for user-visible or cross-boundary flows;
- `npm run build` when build/runtime integration changed;
- `npm run check:sensitive-files`, `npm audit`, and `git diff --check` before a release recommendation.

Never set `ALLOW_DESTRUCTIVE_TESTS`, `RUN_DATABASE_TESTS`, or `HOMOLOGATION_EXTERNAL_TESTS` merely to make a gate pass. The target must independently be proven disposable or explicitly authorized homologation. Real WhatsApp calls are never part of automated tests.

## Claims

Report commands, results, skipped coverage, environment, and date. Use `PASS`, `FAIL`, `SKIPPED`, or `UNKNOWN`; do not convert absence of an error into proof. A change is complete only when its material claims have matching evidence. A local pass does not prove CI, preview, homologation, or production.

