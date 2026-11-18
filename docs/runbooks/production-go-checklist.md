# ALFA CABELOS — production GO checklist (VPS)

Executes only after an explicit GO. Every step references `deploy/vps/README.md`. Production
Supabase project: `fcjmntkcbenjpctjllvi`. Nothing here is automated; each step is checked by a person.

## 1. Preconditions

- [ ] Release SHA has a green GitHub Actions run (audit, lint, typecheck, migrations, unit, integration, E2E, build).
- [ ] Domain purchased; DNS `A <domain>` and `A homolog.<domain>` point to the VPS (TTL 300 s before cutover).
- [ ] Homologation on `https://homolog.<domain>` passed the browser suite on its public certificate.
- [ ] Encrypted production backup taken **the same day**, restore-tested (row counts and migration list match).
- [ ] Evolution runs Baileys 7.0.0-rc12 or newer (currently `local/evolution-api:2.3.7-baileys-rc14`), instance
      `open`, inbound messages being stored, and a real message confirmed readable on a phone within 24 h.
- [ ] `evolution.mi7anda.cloud` resolves publicly (the production app calls it by name).

## 2. Production `app.env` (VPS `/opt/alfa-cabelos/src/deploy/vps/app.env`, mode 600)

Generate new secrets on the VPS; never copy homologation values.

| Variable | Production value |
|---|---|
| `APP_ENV` | `production` |
| `APP_URL`, `NEXT_PUBLIC_APP_URL` | `https://<domain>` (exactly the public origin) |
| `DATABASE_URL` | Supabase transaction pooler of `fcjmntkcbenjpctjllvi` (`:6543`, `pgbouncer=true`) |
| `DIRECT_URL` | Supabase session pooler or direct URL of the same project (migrations/backups only) |
| `SUPABASE_PROJECT_REF` | `fcjmntkcbenjpctjllvi` |
| `SUPABASE_URL` | `https://fcjmntkcbenjpctjllvi.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | production service role key |
| `SUPABASE_STORAGE_BUCKET` | `barber` |
| `PRODUCTION_SUPABASE_PROJECT_REF` | `fcjmntkcbenjpctjllvi` (must equal `SUPABASE_PROJECT_REF`, or WhatsApp never sends) |
| `PRODUCTION_APP_HOST`, `PRODUCTION_STORAGE_BUCKET` | `<domain>`, `barber` |
| `CRON_SECRET` | new: `openssl rand -hex 32`; same value in `scheduler.env` |
| `PASSWORD_RESET_SECRET` | new: `openssl rand -base64 64 \| tr -d '\n'` |
| `WHATSAPP_ENABLED` | `false` at first; `true` only at step 4.6 |
| `WHATSAPP_PROVIDER` | `evolution` |
| `WHATSAPP_API_URL` | `https://evolution.mi7anda.cloud/message/sendText/{instanceId}` |
| `WHATSAPP_API_TOKEN` | the instance token of `Vitor Barbeiro` (not the Evolution global key) |
| `WHATSAPP_INSTANCE_ID`, `PRODUCTION_EVOLUTION_INSTANCE_ID` | `Vitor Barbeiro` (both) |
| `WHATSAPP_OWNER_PHONE` | **empty**: the owner is the sender; owner alerts live in the admin panel |
| `WHATSAPP_CANARY_*` | absent (any enabled value blocks every send) |

`deploy.env`: `APP_VERSION=<sha>`, `APP_PORT=13100`. Compose project: `alfa-cabelos-production`.

## 3. Database

1. `npx prisma migrate status` against production: exactly one pending, `20261107120000_add_password_reset_challenge`.
2. With GO: `npx prisma migrate deploy`; `migrate status` → up to date. The migration is additive
   (table + indexes + RLS) and was applied cleanly to a restored copy of production on 2026-11-17.
3. Legacy outbox: the release's validity policy retires all 12 old `PENDING` rows without sending
   (dry-run 2026-11-17: 7 reminders and 1 staff notice for past bookings, 4 recovery codes with
   expired/missing tokens). No manual cleanup needed.

## 4. Cutover

1. Build and start the production stack on the VPS with `WHATSAPP_ENABLED=false`; `/api/ready` → ready.
2. Nginx site from the template (no `@NOINDEX@`), certificate via certbot, `nginx -t && systemctl reload nginx`.
3. Smoke on the public URL: home, client login, admin login, booking preview, `/api/ready`;
   `/api/internal/notifications/process` must return 404 from outside.
4. Disable the Vercel cron (remove the project's cron or set Vercel `CRON_SECRET` to a value the
   worker rejects) and set Vercel `WHATSAPP_ENABLED=false`; redeploy Vercel.
5. Confirm the Vercel worker heartbeat stops (`OperationalHeartbeat.notification-outbox` stops updating from Vercel).
6. Set `WHATSAPP_ENABLED=true` on the VPS, `docker compose ... up -d app`; watch one scheduler tick
   (`tick` with `status: 200`) and `whatsapp.send_blocked` (must not appear for real customers).
7. Point `alfacabelos.vercel.app` visitors to the new domain (Vercel redirect or notice page).

## 5. Rollback (any step)

| Layer | Action |
|---|---|
| Sends | `WHATSAPP_ENABLED=false` on the VPS, `up -d app` (outbox waits, stale rows expire) |
| App | previous image tag in `deploy.env`, `up -d`; or `src.prev` |
| Scheduler | `docker compose ... stop scheduler` |
| Proxy | remove the site link, `nginx -t && systemctl reload nginx` |
| DNS | restore previous records (operator) |
| Traffic | Vercel production stays deployable; re-enable its cron only after the VPS sends are off |
| Database | migration stays (additive); data restore only with a separate GO and the verified backup |

## 6. Domain and homologation policy

- Production: `<domain>` (and `www` redirect if desired); canonical, sitemap and robots derive from `APP_URL`.
- Homologation: `homolog.<domain>`; `robots.txt` disallows everything outside `APP_ENV=production`
  and the Nginx template adds `X-Robots-Tag: noindex`. Homologation never shares secrets or the database with production.
- Certificates are issued only after DNS resolves to the VPS.
