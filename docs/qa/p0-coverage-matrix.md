# ALFA CABELOS — P0 coverage matrix

Release candidate: `integration/p0-alfa-release`. Layers: **U** unit, **I** integration on disposable
PostgreSQL, **E** Playwright E2E (Chromium desktop/Android/tablet, WebKit iPhone, Firefox over HTTPS lab),
**S** staging/VPS run, **P** production read-only or restored copy. Real WhatsApp is listed only where a
human confirmed a readable message on a phone.

| Area | Actor | Flow / state | Evidence | Layers |
|---|---|---|---|---|
| Client auth | Client | Register, login, logout, wrong password, incomplete phone, client without password (first password CTA), double submit blocked | `e2e/authentication.spec.ts`, `e2e/booking-journey.spec.ts` | E |
| Client auth | Client | Session expiry, authenticated user not sent back to login, open redirect blocked | `e2e/authentication.spec.ts`, `tests/safe-redirect.test.ts` | U, E |
| Staff auth | Admin, Barber | Admin login returns only to admin routes; barber limited to own panel; client cannot reach staff panel; password change revokes staff sessions | `e2e/authentication.spec.ts`, `tests/admin-session-revocation.test.ts`, `tests/rbac.test.ts` | U, E |
| Password recovery | Client | Code (8 digits, HMAC, 10 min), 5 attempts, resend interval, 5 challenges/hour, enumeration-safe responses, reuse rejected, concurrent completion, sealed payload, sessions revoked, old links invalidated | `tests/password-recovery-code.test.ts`, `tests/password-recovery.integration.test.ts`, `tests/password-recovery-ui.test.ts` | U, I |
| Password recovery | Client | Real code over WhatsApp typed by the operator; new password works, old rejected, previous sessions revoked | canary #11 (2026-11-18) | S, real |
| Booking | Client | Wizard: service, professional, date, slot, review, confirm; client history; cancel | `e2e/booking-journey.spec.ts` | E |
| Booking | Client, Staff | Availability (duration, buffer, lunch, blocks, merged ranges, Porto Velho → UTC), conflicts, serializable races (1 × 201 / n × 409), idempotency | `tests/availability.test.ts`, `tests/booking-conflict.test.ts`, `scripts/test-api-concurrency.ts`, load test 40-client race | U, I, S |
| Booking | Client | Token confirmation without password: valid, expired, reused, wrong state | `tests/confirmation-security.test.ts` | U |
| Recurrence | Client, Staff | Daily/weekly/monthly, biweekly, Feb edge, limit 60, partial cancel (single/future/all), reschedule first and middle occurrence, consolidated notice, past occurrences excluded | `tests/recurrence.test.ts`, `tests/series-notice.integration.test.ts`, `tests/booking-notifications.integration.test.ts`, E2E "quartas-feiras" | U, I, E |
| Admin panel | Admin, Barber | Dashboard, agenda, operations status, bounded queries, incremental polling, earnings timezone | `tests/query-contracts.test.ts`, `tests/earnings-timezone.integration.test.ts`, restored-production probe (agenda, alerts, status 200) | U, I, P |
| Owner alerts | Admin, Barber | Created, cancelled, rescheduled (single and series), one alert per change, no duplicate on replay, barber scoping, unlinked barber 403, unseen badge, mark seen, persists after reload, works without the panel open (stored in the booking transaction) | `tests/owner-alerts.integration.test.ts`, `e2e/booking-journey.spec.ts`, `e2e/responsive-a11y.spec.ts` | I, E |
| Notifications | System | Client/staff create, cancel, reschedule, reminder (client only), series, same number for both audiences, invalid phone, after-commit only, rollback leaves nothing, partial failure + retry, provider down, disabled worker, expiry 6 h, concurrency, idempotency, replay audited | `tests/booking-notifications*.ts`, `tests/notification-outbox.integration.test.ts`, `tests/notification-lifecycle.test.ts` | U, I |
| Send gate | System | Fail-closed policy, homologation canary only, allowlist, DB budget atomic and restart-safe, production identity, positive control | `tests/whatsapp-send-authorization.test.ts`, `tests/whatsapp-canary.integration.test.ts`, 6 scenarios on the real image | U, I, S |
| Real WhatsApp | Operator | Transport (#10) and recovery code (#11) readable on the phone | canary 2026-11-18 | real |
| Scheduler | System | 5-minute ticks, retry policy, liveness healthcheck, 401 on bad secret | `tests/notification-scheduler.test.ts`, VPS logs | U, S |
| Resilience | System | DB down (503, recovery without restart), provider down, timeouts, stale locks, unverifiable rows bounded | `tests/database-unavailable.test.ts`, outbox lifecycle tests, outage drill | U, I, S |
| Security | All | Same-origin/CSRF, XFF overwrite, payload limits, Zod bounds, uploads (MIME/extension), logs redact secrets/PII, audit append-only, RLS on every table, internal endpoint 401/404 | `tests/same-origin.test.ts`, `tests/validation-limits.test.ts`, `tests/media-security.test.ts`, `tests/observability.test.ts`, probes | U, I, S, P |
| UI/UX | All | Overflow 320–1440 px, accessible names, `lang`, alt, console/5xx errors, keyboard focus, reduced motion | `e2e/responsive-a11y.spec.ts` | E |
| Database | — | 23 migrations on homologation; production 22 + migration 23 rehearsed on a restored copy with drift zero | migrate status, `prisma migrate diff` | S, P |

**Known gaps (not covered by automated tests):** real readable delivery of the booking templates
(creation, cancellation, reschedule, series) after the Evolution fix — covered by the fake provider and,
for creation, by canary #12 when confirmed; contrast ratios are checked visually, not by an automated
tool; the public domain (TLS, cookies, canonical) can only be validated after it is purchased.
