---
name: browser-verification
description: Use to verify an ALFA-CABELOS UI regression, critical browser flow, mobile-only issue, form, dialog, authentication path, or user-visible behavior claim.
---

# Browser verification

Verify the user-visible behavior in a real browser context without causing unintended external effects.

## Prerequisites

Identify the exact URL, environment, account role, and expected behavior. Use local, disposable, or explicitly authorized isolated homologation data. Apply `production-safety` if the target is shared, remote, or ambiguous.

## Workflow

1. Reproduce the starting state and record the route, viewport, role, and relevant test data.
2. Check desktop and mobile viewports when layout or interaction can vary.
3. Exercise the critical path, including forms, dialogs, validation, keyboard behavior, authentication, and RBAC where relevant.
4. Inspect console errors, failed network requests, blocked resources, overlays, focus order, and accessible names.
5. Capture a screenshot only when it adds useful evidence; sanitize PII and secrets.
6. If a boundary fails, record the first failure and switch to `systematic-debugging`.
7. Re-run the original path after the change, then use `verification-before-completion`.

Disable, intercept, or replace WhatsApp and other real external side effects with approved test doubles. Do not create or alter production data merely to complete a browser check.

A visually correct page does not prove API, database, queue, or provider correctness. Report those layers separately unless directly verified.
