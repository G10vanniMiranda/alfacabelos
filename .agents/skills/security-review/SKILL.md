---
name: security-review
description: Use for an explicit ALFA-CABELOS security audit or for changes to authentication, authorization, sensitive data, uploads, integrations, or trust boundaries.
---

# Security review

Produce evidence-backed findings for the exact scope. Do not broaden the review or probe production without authorization.

## Workflow

1. Define the assets, actors, entry points, data flows, trust boundaries, and environment in scope.
2. Inspect the code, tests, configuration, and relevant diff before assessing risk.
3. Check applicable threats: authentication, authorization and IDOR, RLS and grants, injection, XSS, CSRF, SSRF, path traversal, unsafe uploads, secret exposure, dependency risk, and internal API access.
4. Trace each suspected issue to a reachable path and an affected asset. Use safe local or isolated negative tests when permitted.
5. Report each finding with severity, evidence, exploit conditions, impact, and the smallest safe remediation. Say explicitly when no finding is supported.

Use the domain procedure alongside this skill:

- `alfa-supabase-safety` for PostgreSQL, Supabase, RLS, grants, storage, and migrations.
- `alfa-evolution-operations` for Evolution or WhatsApp paths.
- `production-safety` before any shared or remote mutation.
- `alfa-change-verification` after an authorized fix.

## Guardrails

- Never print secret values, tokens, private payloads, or customer PII.
- Do not invent vulnerabilities from naming or incomplete snippets.
- Distinguish proven exploitability from defense-in-depth recommendations.
- Do not auto-fix unrelated findings or update dependencies broadly without approval.
- Use `claim-verification` for inherited audit claims and `verification-before-completion` for the final result.
