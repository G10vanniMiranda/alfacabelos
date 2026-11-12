# ALFA CABELOS — VPS deployment runbook

Stack: one Next.js container (`app`) behind the existing Traefik, one scheduler container
(`scheduler`) calling the notification worker every 5 minutes, database on Supabase.
Nothing here creates a PostgreSQL server, opens a host port, or changes DNS.

## Files

| File | Tracked | Purpose |
|---|---|---|
| `docker-compose.yml` | yes | Services, hardening, Traefik labels |
| `deploy.env.example` | yes | Non-secret deploy settings (image tag, host, Traefik names) |
| `app.env.example` | yes | App runtime variables (secrets) |
| `scheduler.env.example` | yes | Scheduler variables (only `CRON_SECRET`) |
| `deploy.env`, `app.env`, `scheduler.env` | **no** (`.gitignore`) | Real values, `chmod 600`, owned by the deploy user |

## Prerequisites (operator)

1. Traefik running with a Docker provider, an HTTPS entrypoint and a certificate resolver.
   Put their names in `deploy.env` (`TRAEFIK_NETWORK`, `TRAEFIK_ENTRYPOINT`, `TRAEFIK_CERTRESOLVER`).
   Keep the entrypoint's `forwardedHeaders` untrusted (Traefik's default): the app's rate limits use
   `X-Forwarded-For`, which Traefik must overwrite with the real client address.
2. An approved hostname (`APP_HOST`) whose DNS already points to the VPS.
   Until a hostname is approved, run only the private smoke test below.
3. Supabase project matching `APP_ENV` (homologation for staging; production only after GO).

## Deploy or update

```sh
cd /opt/alfa-cabelos            # git checkout of the approved SHA
git fetch && git checkout <SHA>
cd deploy/vps
sed -i "s/^APP_VERSION=.*/APP_VERSION=$(git rev-parse --short HEAD)/" deploy.env
docker compose --env-file deploy.env build app
docker compose --env-file deploy.env up -d
docker compose --env-file deploy.env ps          # app must be "healthy"
curl -fsS https://$APP_HOST/api/ready             # {"status":"ready",...}
docker compose --env-file deploy.env logs --tail=5 scheduler
```

The image is built once per SHA and tagged `alfa-cabelos:<SHA>`; keep the previous tag for rollback.

### Private smoke test (no hostname yet)

```sh
docker compose --env-file deploy.env up -d
docker compose --env-file deploy.env exec scheduler node -e \
  "fetch('http://app:3000/api/ready').then(async r=>console.log(r.status, await r.text()))"
```

## Database migrations (separate step, production needs GO)

The containers never run migrations. With GO and a fresh backup:

```sh
# from a checkout of the approved SHA, with DIRECT_URL of the target project in the shell only
npx prisma migrate status            # must list only the expected pending migration(s)
npx prisma migrate deploy
npx prisma migrate status            # "Database schema is up to date"
```

The P0 release adds one additive migration, `20261107120000_add_password_reset_challenge`
(new table + indexes + RLS). Rollback of the app does not require dropping it.

## Backup and restore (PostgreSQL 15 on Supabase)

The Supabase Free plan has no managed backups or PITR. Before any production migration:

```sh
install -d -m 700 /var/backups/alfa-cabelos
# client major = server major (production is PostgreSQL 15)
docker run --rm -v /var/backups/alfa-cabelos:/backup -e DIRECT_URL postgres:15 \
  sh -c 'pg_dump "$DIRECT_URL" --format=custom --schema=public --no-owner --no-privileges \
         --file=/backup/alfa-prod-$(date -u +%Y%m%dT%H%M%SZ).dump'
chmod 600 /var/backups/alfa-cabelos/*.dump
```

Restore test (into a scratch database, never into production without a separate GO):

```sh
docker run -d --name restore-test -e POSTGRES_PASSWORD=restore postgres:15
docker exec restore-test psql -U postgres -c "CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;"
docker cp /var/backups/alfa-cabelos/<file>.dump restore-test:/tmp/backup.dump
docker exec restore-test pg_restore -U postgres -d postgres --no-owner /tmp/backup.dump
docker exec restore-test psql -U postgres -c 'SELECT count(*) FROM public."_prisma_migrations"'
docker rm -f restore-test
```

Dumps contain personal data: keep them on the VPS (mode 600), never in Git, chat or tickets.

## Rollback

1. `sed -i "s/^APP_VERSION=.*/APP_VERSION=<previous SHA>/" deploy.env && docker compose --env-file deploy.env up -d`
2. Check `/api/ready`. The additive migration stays in place.
3. While traffic is still on Vercel, rollback is a Vercel promote of the previous production deployment.

## Scheduler

- `scheduler` calls `GET http://app:3000/api/internal/notifications/process` with `Authorization: Bearer $CRON_SECRET`
  at every 5-minute boundary (`NOTIFICATION_SCHEDULER_INTERVAL_SECONDS`, bounded 60–3600).
- One request at a time; failures (network, timeout, 5xx) are retried once after 20 s, then the next tick.
- The worker is idempotent (SKIP LOCKED claims + lease); a late, missed or duplicated tick cannot double-send.
- `/api/internal/*` is not routed by Traefik; only the `backend` network reaches it.
- Health: `docker compose logs scheduler | grep tick_failed`; the app also records worker heartbeats
  and backlog in `/api/admin/operations/status`.
- `WHATSAPP_ENABLED=false` keeps every notification in the outbox; stale rows expire by policy instead of sending later.

## Cutover from Vercel (needs GO and an approved domain)

1. Deploy the approved SHA here with production `app.env`; verify `/api/ready` on the new host.
2. Point the approved domain to the VPS (DNS change by the operator).
3. `alfacabelos.vercel.app` cannot be redirected by DNS: keep the Vercel project serving a redirect or
   a notice to the new domain, and update links shared with customers.
4. Keep the Vercel deployment available until the new host has run cleanly for the agreed period.
