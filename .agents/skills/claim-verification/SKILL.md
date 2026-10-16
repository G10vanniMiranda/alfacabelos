---
name: claim-verification
description: Use when reviewing implementation, security, QA, SRE, or readiness claims made by another agent, operator, or report.
---

# Claim verification

Treat a claim as an assertion to audit, not as evidence.

## Classification

Classify every material claim as exactly one of:

- `EVIDENCE`: directly observed, current, reproducible proof for the exact target.
- `INFERENCE`: a reasoned conclusion supported by evidence but not directly observed.
- `ASSUMPTION`: an untested premise being relied upon.
- `NOT VERIFIED`: proof is absent, stale, incomplete, or for a different target.

## Workflow

1. Inventory the material claims and the target, artifact, environment, and time each claim concerns.
2. Trace every claim to its original evidence rather than another summary.
3. Inspect the relevant diff, configuration, logs, test output, or runtime result.
4. Reproduce the proof when safe and permitted. Use `verification-before-completion` for fresh checks.
5. Record contradictions, skipped checks, scope gaps, and environmental limits.

An agent report, screenshot, or pasted success line is not sufficient by itself. Local evidence cannot verify CI, homologation, or production. A remote claim remains `NOT VERIFIED` unless current read-only evidence covers the exact target; remote mutation still requires `production-safety` and explicit authorization.

## Output

Use a compact table with: claim, classification, evidence, target, and remaining gap. Do not convert an inference into evidence or hide an unknown behind confident wording.
