# ALFA CABELOS — production GO checklist (VPS)

Executes only after an explicit GO. Every step references `deploy/vps/README.md`. Production
Supabase project: `fcjmntkcbenjpctjllvi`. Nothing here is automated; each step is checked by a person.

## 1. Preconditions

- [ ] Release SHA has a green GitHub Actions run (audit, lint, typecheck, migrations, unit, integration, E2E, build).
- [ ] Domain purchased; DNS `A <domain>` and `A homolog.<domain>` point to the VPS (TTL 300 s before cutover).
- [ ] Homologation on `https://homolog.<domain>` passed the browser suite on its public certificate.
- [ ] Encrypted production backup taken **the same day**, restore-tested (row counts and migration list match).
- [ ] Evolution runs Baileys 7.0.0-rc12 or newer **with the `<status>` ack fix** (currently
      `local/evolution-api:2.3.7-baileys-rc14-sec1-statusack`); 24 h of `/root/diag/evolution-health.log` with
      inbound messages stored and no `stream errored out ... class=status`; a real message confirmed readable on a phone.
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

## 3. Release procedure (in this order; stop and roll back at the first failed check)

Shell variables: `P=alfa-cabelos-production`, `C="docker compose -p $P --env-file deploy.env"`, run
from `/opt/alfa-cabelos/src/deploy/vps`. Database commands run from a checkout of the release SHA
on the operator workstation, with the production `DIRECT_URL` only in that shell.

1. **GO recorded** (who, when, release SHA, domain).
2. **Backup** of the same day, encrypted and restore-tested (`deploy/vps/README.md`, "Backup and restore").
   Rehearsed 2026-11-18: 22 migrations, 147 bookings, 63 clients, 23 outbox rows, RLS 18/18.
3. **Migration**: `npx prisma migrate status` must list exactly `20261107120000_add_password_reset_challenge`;
   then `npx prisma migrate deploy`; `npx prisma migrate status` → "Database schema is up to date".
   Rehearsed on the restored copy: applied cleanly, `prisma migrate diff --from-url <db> --to-schema-datamodel
   prisma/schema.prisma --exit-code` → no difference (drift zero), new table with RLS, data intact.
4. **Database check**: read-only snapshot (23 migrations applied, RLS on all tables including the new one,
   counts unchanged) and the legacy outbox dry-run:
   all 12 old `PENDING` rows are `INVALID` (7 reminders and 1 staff notice for past bookings, 4 recovery
   codes with expired/missing tokens) and are retired without sending on the first worker run.
5. **Image**: ship `git archive <sha>`, `$C build app`, `$C up -d` with `WHATSAPP_ENABLED=false`;
   `$C ps` both healthy; `curl -fsS http://127.0.0.1:13100/api/ready` → ready.
6. **Domain**: DNS `A <domain>` → VPS; certbot webroot; Nginx site from the template without `@NOINDEX@`;
   `nginx -t && systemctl reload nginx`; `APP_URL`/`NEXT_PUBLIC_APP_URL=https://<domain>`, `$C up -d app`.
7. **Production smoke** on `https://<domain>`: home, `/robots.txt` (allows `/`, lists the sitemap),
   client login, admin login, availability, `/api/ready`; `/api/internal/notifications/process` → 404.
8. **Scheduler handover**: merging the release to `main` redeploys Vercel **without** the cron (removed from
   `vercel.json` in this release), so the VPS scheduler is the only worker. Before enabling WhatsApp,
   confirm `OperationalHeartbeat.notification-outbox` is now updated only every 5 minutes on the boundary
   by the VPS (`$C logs scheduler | grep tick`). Keep Vercel `WHATSAPP_ENABLED=false`.
9. **WhatsApp**: `WHATSAPP_ENABLED=true` in production `app.env`, `$C up -d app`; first tick shows the 12
   legacy rows as `expired` (none sent); then one real booking by the operator, confirmed readable on the phone.
10. **Monitor** the first 24 h: `$C ps`, `tick_failed`, `whatsapp.send_blocked`, `notification.dead`,
    `/api/admin/operations/status` backlog, Nginx 5xx.
11. **Rollback** at any failed step (section 5). Point `alfacabelos.vercel.app` visitors to the new domain
    (Vercel redirect or notice page) only after step 10 is clean.

## 5. Rollback (any step)

| Layer | Action |
|---|---|
| Sends | `WHATSAPP_ENABLED=false` on the VPS, `up -d app` (outbox waits, stale rows expire) |
| App | previous image tag in `deploy.env`, `up -d`; or `src.prev` |
| Scheduler | `docker compose ... stop scheduler` |
| Proxy | remove the site link, `nginx -t && systemctl reload nginx` |
| DNS | restore previous records (operator) |
| Traffic | Promote the previous Vercel production deployment (it still carries the old cron); stop the VPS scheduler first so only one worker runs |
| Database | migration stays (additive); data restore only with a separate GO and the verified backup |

## 6. Domain and homologation policy

- Production: `<domain>` (and `www` redirect if desired); canonical, sitemap and robots derive from `APP_URL`.
- Homologation: `homolog.<domain>`; `robots.txt` disallows everything outside `APP_ENV=production`
  and the Nginx template adds `X-Robots-Tag: noindex`. Homologation never shares secrets or the database with production.
- Certificates are issued only after DNS resolves to the VPS.
