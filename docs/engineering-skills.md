# ALFA-CABELOS engineering skills

## Canonical layout

The repository's only canonical skill tree is `.agents/skills/<skill-name>/SKILL.md`. There is no `.claude/skills` projection. Each skill is repository-local, declarative, and has no runtime dependency or bundled executable script.

The routing entry point is `.agents/skills/alfa-task-routing/SKILL.md`. Load the smallest set that covers the request; loading a skill never grants permission for remote or destructive actions.

## Inventory

The five existing ALFA-CABELOS skills remain the domain and release authorities:

| Skill | Responsibility |
| --- | --- |
| `alfa-task-routing` | Minimum skill selection for project work |
| `alfa-change-verification` | Project-specific diagnosis, implementation, and validation |
| `alfa-evolution-operations` | Evolution, WhatsApp, outbox, worker, and replay safety |
| `alfa-supabase-safety` | Supabase, PostgreSQL, RLS, grants, Storage, and migrations |
| `alfa-release-gate` | Homologation, production readiness, cron, observability, and release evidence |

Eight engineering skills complement them:

| Skill | Responsibility | Adaptation basis |
| --- | --- | --- |
| `using-superpowers` | Select project skills before acting | Superpowers 6.3.0 workflow, reduced to repository routing |
| `systematic-debugging` | Find the first broken boundary and root cause | Superpowers 6.3.0 four-phase debugging method |
| `test-driven-development` | Apply RED, GREEN, REFACTOR to testable behavior | Superpowers 6.3.0 TDD workflow |
| `verification-before-completion` | Require fresh evidence for completion claims | Superpowers 6.3.0 verification discipline |
| `claim-verification` | Audit third-party or agent assertions | Project-authored evidence classification |
| `security-review` | Perform scoped, evidence-backed security review | OpenAI security best-practice guidance, adapted to ALFA boundaries |
| `production-safety` | Gate shared, ambiguous, and production mutations | Project-authored environment and authorization gate |
| `browser-verification` | Verify user-visible browser flows safely | Vercel browser-verification guidance, adapted to local and homologation use |

## Composition rules

| Scenario | Minimum route |
| --- | --- |
| Booking bug | `systematic-debugging` + `alfa-change-verification`; add TDD when behavior is testable |
| Supabase migration | `alfa-supabase-safety` + `production-safety` + `alfa-change-verification` |
| WhatsApp delivery failure | `alfa-evolution-operations` + `systematic-debugging` + `alfa-change-verification` |
| Mobile UI regression | `systematic-debugging` + `browser-verification` + `alfa-change-verification` |
| Security audit | `security-review` + affected domain skill + `alfa-change-verification` |
| Release or deploy readiness | `production-safety` + `alfa-change-verification` + `claim-verification` + `alfa-release-gate` |

Before reporting any material result as fixed, passing, safe, ready, or complete, apply `verification-before-completion`. Add `claim-verification` only when the supporting assertions came from another agent, operator, or report.

## Maintenance procedure

1. Confirm that an existing project skill cannot cover the need through composition.
2. Inspect the upstream source and license; never run an installer or bundled script blindly.
3. Adapt instructions to ALFA-CABELOS boundaries and remove unrelated tools, remote mutations, and dependency assumptions.
4. Keep the directory name and frontmatter `name` identical, with a trigger-oriented `description`.
5. Validate the new skill individually, then validate the complete inventory, routing scenarios, relative links, and repository diff.
6. Update this inventory and `alfa-task-routing` only when routing behavior changes.

If Claude Code compatibility becomes necessary later, prefer a directory junction or symlink to `.agents/skills`, or minimal wrappers that point to the canonical files. Do not maintain duplicated skill bodies.
