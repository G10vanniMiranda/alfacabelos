---
name: test-driven-development
description: Use when implementing or changing testable ALFA-CABELOS behavior, including features, bug fixes, and refactors.
---

# Test-driven development

Use a short RED, GREEN, REFACTOR loop for observable behavior.

## When it applies

Use TDD for features, bug fixes, behavior changes, and behavior-preserving refactors with meaningful automated boundaries.

Do not force an artificial test for documentation, inventories, generated files, agent instructions, or pure configuration. For configuration, define the invariant and run its direct validator instead.

## Loop

1. Define one observable behavior and the realistic regression the test must catch.
2. Write the smallest test at the appropriate boundary.
3. Run it and observe failure for the expected reason. A test that passes immediately is not RED.
4. Implement the smallest coherent change that makes it pass.
5. Run the focused test, then the relevant broader checks.
6. Refactor only while the checks remain green.

Prefer public behavior over implementation details. Mock only true external boundaries; do not make the mock the subject of the assertion.

## Safety boundaries

- Database tests require a disposable or explicitly approved isolated environment.
- Never send real WhatsApp messages or trigger another external side effect from a test.
- Use `production-safety` before any test that could mutate a shared or ambiguous remote target.
- Finish with `verification-before-completion` before claiming the change works.

## Stop conditions

If RED cannot be observed, the boundary may be wrong or the behavior may be untestable as framed. Reassess rather than writing production code first and backfilling a passing test.
