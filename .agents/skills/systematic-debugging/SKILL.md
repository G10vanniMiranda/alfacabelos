---
name: systematic-debugging
description: Use when an ALFA-CABELOS bug, failing test, build error, integration failure, performance regression, or unexpected behavior needs diagnosis.
---

# Systematic debugging

Find the first broken boundary and root cause before changing code.

## Workflow

1. Capture the exact symptom, command, exit code, environment class, and reproducible steps. Do not print secret values or PII.
2. Inspect recent relevant changes and compare with a working path.
3. Trace inputs and outputs across UI, API, service, database, worker, and provider boundaries as applicable.
4. State one falsifiable hypothesis: cause, supporting evidence, and the smallest safe test.
5. Change one variable. If disproved, return to evidence rather than stacking fixes.
6. Once confirmed, use `test-driven-development` when behavior is testable, make the smallest coherent fix, and use `verification-before-completion`.

After three failed fix attempts, stop and reassess the architecture with the user.

## Quick reference

| State | Action |
| --- | --- |
| Not reproducible | Gather logs or a deterministic probe; do not guess |
| Multi-component | Instrument each boundary with sanitized metadata |
| External dependency | Separate local evidence from provider/environment assumptions |
| Destructive test required | Use `production-safety` before proceeding |

## Common mistakes

- Treating an error message as the root cause without tracing its input.
- Changing several layers at once.
- Using production to reproduce a localizable defect.
- Calling a symptom fix complete without a regression check.
