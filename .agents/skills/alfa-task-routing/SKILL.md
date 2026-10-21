---
name: alfa-task-routing
description: Route ALFA-CABELOS bug, migration, Supabase, WhatsApp, security, verification, incident, and release work to the minimum project skills.
---

# ALFA-CABELOS task routing

Select only the skills needed for the current request. Loading a skill does not authorize remote writes, messages, deploys, migrations, secret changes, or data deletion.

## Routes

| Task | Required project skills | Add only when needed |
| --- | --- | --- |
| Bug or regression | `systematic-debugging`, `alfa-change-verification` | `test-driven-development` for testable behavior; affected domain skill |
| Feature or refactor | `alfa-change-verification` | `test-driven-development` for testable behavior; affected domain skill |
| Migration, RLS, grants, schema, Storage | `alfa-supabase-safety`, `production-safety`, then `alfa-change-verification` | `alfa-release-gate` when promotion is in scope |
| WhatsApp, notification, outbox, worker, cron, replay | `alfa-evolution-operations`, `systematic-debugging`, then `alfa-change-verification` | `production-safety` for a real send or remote mutation; `alfa-release-gate` for homologation or release |
| UI or mobile regression | `systematic-debugging`, `browser-verification`, `alfa-change-verification` | `test-driven-development` for testable behavior; affected domain skill |
| Security change or audit | `security-review`, relevant domain skill, then `alfa-change-verification` | `systematic-debugging` for a reproduced finding; `claim-verification` for inherited claims; `alfa-release-gate` when readiness is affected |
| Incident | `systematic-debugging`, relevant domain skill, and project runbook | `production-safety` before remote mutation; `alfa-release-gate` only for a recovery release |
| Homologation or production readiness | `production-safety`, `claim-verification`, `alfa-release-gate`, plus affected domain skills | `alfa-change-verification` for code changes; `browser-verification` for critical UI flows |
| Release | `production-safety`, `alfa-change-verification`, `claim-verification`, `alfa-release-gate`; add every affected domain skill | `browser-verification` for critical user-visible flows |

For ordinary documentation or read-only analysis, do not load operational skills unless their invariants affect the answer.

Use `verification-before-completion` immediately before every material claim that work is fixed, passing, safe, ready, or complete. Use `claim-verification` only when evidence or assertions came from another agent, operator, or report. `using-superpowers` supplies the selection procedure but does not replace this router.

## Canonical evidence

Prefer current repository state, executable checks, and environment classification over historical claims. The phase documents are evidence of what was observed at their dates, not proof of current production state.
