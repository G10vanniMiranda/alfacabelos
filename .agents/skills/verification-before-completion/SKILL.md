---
name: verification-before-completion
description: Use immediately before claiming ALFA-CABELOS work is fixed, passing, safe, ready, or complete.
---

# Verification before completion

Every completion claim needs fresh evidence from the exact artifact and environment in scope.

## Evidence contract

For each material claim:

1. Name the command, probe, or inspection that would prove it.
2. Run it now against the intended target.
3. Read the exit code and the complete relevant result, including failures and skips.
4. Classify the claim as `PASS`, `FAIL`, `SKIPPED`, or `UNKNOWN`.
5. Report the evidence and limitations without upgrading one environment into another.

| Claim | Minimum evidence |
| --- | --- |
| Tests pass | Fresh test run with zero relevant failures |
| Build succeeds | Fresh build with exit code zero |
| Bug is fixed | Original reproduction plus regression check |
| Security control works | Targeted negative and positive checks where safe |
| Ready for release | `alfa-release-gate` evidence for the exact target |

Local success does not prove CI, homologation, or production. A code inspection does not prove runtime behavior. A passing focused test does not prove an unrelated suite.

If a required check cannot run, say why and mark it `SKIPPED` or `UNKNOWN`. Do not use "should pass," "appears fixed," or a previous run as a completion claim.

Use `claim-verification` when the evidence or claim came from another agent, report, or operator.
