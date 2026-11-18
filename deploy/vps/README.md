# ALFA CABELOS — VPS deployment runbook

Real host layout (MI7ANDA VPS): **host Nginx** terminates TLS (certbot) for every site; other
projects (Evolution API, n8n, Portainer) run as Docker Swarm services. Traefik is legacy and
inactive: do not install or start it. ALFA runs as a standalone Compose project per environment:

- `app`: Next.js, published only on `127.0.0.1:${APP_PORT}`; Nginx proxies the public hostname to it.
- `scheduler`: calls the notification worker every 5 minutes over the private `backend` network.
- Database: Supabase (homologation `hyrqxnbclwwpzheatwed`, production `fcjmntkcbenjpctjllvi`).

Nothing here creates a PostgreSQL server, opens a public port, changes the firewall, or touches
other projects' Nginx sites, networks or services.

| Environment | Directory | Compose project | `APP_PORT` | Nginx site |
|---|---|---|---|---|
| Staging (homologation) | `/opt/alfa-cabelos-staging` | `alfa-cabelos-staging` | `13110` | `alfa-cabelos-homolog` |
| Production | `/opt/alfa-cabelos` | `alfa-cabelos-production` | `13100` | `alfa-cabelos-production` |

## Files

| File | Tracked | Purpose |
|---|---|---|
| `docker-compose.yml` | yes | Services, hardening, loopback port, networks, healthchecks |
| `nginx/alfa-cabelos.conf.template` | yes | Host Nginx site (HTTP→HTTPS, ACME, `/api/internal` refused, proxy headers) |
| `deploy.env.example` | yes | Non-secret settings (`APP_VERSION`, `APP_PORT`) |
| `app.env.example` | yes | App runtime variables (secrets) |
| `scheduler.env.example` | yes | Scheduler variables (only `CRON_SECRET`) |
| `deploy.env`, `app.env`, `scheduler.env` | **no** | Real values on the VPS only, `chmod 600`, directory `chmod 700` |

Every command below runs from `<dir>/src/deploy/vps` with `C="docker compose -p <project> --env-file deploy.env"`.

## Deploy or update

The source is shipped as a `git archive` of the approved SHA (no Git credentials on the VPS):

```sh
# workstation
git archive --format=tar.gz -o alfa-<sha>.tar.gz <sha>
sha256sum alfa-<sha>.tar.gz
scp alfa-<sha>.tar.gz root@<vps>:<dir>/
# VPS
cd <dir> && sha256sum alfa-<sha>.tar.gz          # must match
mkdir -p src.new && tar -xzf alfa-<sha>.tar.gz -C src.new
cp src/deploy/vps/{app,scheduler,deploy}.env src.new/deploy/vps/ && chmod 600 src.new/deploy/vps/*.env
mv src src.prev && mv src.new src && cd src/deploy/vps
sed -i "s/^APP_VERSION=.*/APP_VERSION=<sha>/" deploy.env
$C build app                                       # tags alfa-cabelos:<sha>; keep the previous tag
$C up -d
$C ps                                              # app and scheduler "healthy"
curl -fsS http://127.0.0.1:$APP_PORT/api/ready     # {"status":"ready",...}
```

`/api/ready` returns 503 when the configuration guard fails (wrong Supabase project, production
identifiers in homologation, missing secrets, canary misuse). Fix `app.env`, then `$C up -d app`.

## Nginx and certificates (needs an approved hostname whose DNS points to the VPS)

```sh
# 1. ACME over HTTP first (the template's 443 block needs the certificate to exist)
certbot certonly --webroot -w /var/www/html -d <hostname>
# 2. Render and enable the site (homologation adds the noindex header)
sed -e 's/@HOST@/<hostname>/g' -e 's/@PORT@/<APP_PORT>/g' \
    -e 's/@NOINDEX@/add_header X-Robots-Tag "noindex, nofollow, noarchive" always;/' \
    nginx/alfa-cabelos.conf.template > /etc/nginx/sites-available/alfa-cabelos-homolog
ln -s /etc/nginx/sites-available/alfa-cabelos-homolog /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx                  # reload, never restart: other sites stay up
curl -fsSI https://<hostname>/ && curl -s -o /dev/null -w '%{http_code}\n' https://<hostname>/api/internal/notifications/process   # 404
```

- Set `APP_URL` and `NEXT_PUBLIC_APP_URL` to `https://<hostname>` exactly; origin checks, cookies
  (`Secure`) and canonical URLs derive from it. `HOMOLOGATION_LOCAL_HTTP` must then be removed.
- Certbot's existing timer renews the certificate; `certbot renew --dry-run` checks it.
- Rollback of the proxy: `rm /etc/nginx/sites-enabled/alfa-cabelos-<env> && nginx -t && systemctl reload nginx`.
- The template overwrites `X-Forwarded-For` with the client address: the app rate-limits on its first entry.

### Private smoke test (no hostname yet)

`curl http://127.0.0.1:$APP_PORT/api/ready` on the VPS, or an SSH tunnel
(`ssh -L 13110:127.0.0.1:13110 root@<vps>`) with `HOMOLOGATION_LOCAL_HTTP=true` and
`APP_URL=http://127.0.0.1:13110` in homologation only.

## Logs, health and recovery

| Check | Command |
|---|---|
| Containers | `$C ps` (both `healthy`) |
| App logs (JSON, secrets redacted) | `$C logs --since=1h app` |
| Scheduler ticks | `$C logs --since=1h scheduler \| grep -E 'tick(_failed)?'` |
| Readiness | `curl -fsS http://127.0.0.1:$APP_PORT/api/ready` |
| Outbox and worker heartbeat | `/api/admin/operations/status` (admin session) |
| Resources | `docker stats --no-stream alfa-cabelos-<env>-app-1 alfa-cabelos-<env>-scheduler-1` |

- The scheduler healthcheck reads a heartbeat the loop writes at start and after every tick; it turns
  `unhealthy` only when the loop stalls (two intervals + 2 min). Worker failures show as `tick_failed`.
- Recovery: `$C restart app` (healthy in ~10 s); `$C up -d --force-recreate scheduler`. Both are
  stateless; the outbox lives in the database, so a restart loses no notification.
- Database or Evolution outage: deliveries go to `RETRY` with backoff and expire by policy instead of
  sending late; nothing needs manual replay unless an operator decides to.

## Scheduler

- `GET http://app:3000/api/internal/notifications/process` with `Authorization: Bearer $CRON_SECRET`
  at every 5-minute boundary (`NOTIFICATION_SCHEDULER_INTERVAL_SECONDS`, bounded 60–3600).
- One request at a time; network errors, timeouts and 5xx are retried once after 20 s; 401/429 are not.
- The worker is idempotent (SKIP LOCKED claims + lease): a late, missed or duplicated tick, or a second
  scheduler, cannot double-send. Still, run **one** production scheduler (see cutover).
- `WHATSAPP_ENABLED=false` keeps notifications in the outbox; stale rows expire by policy.

## WhatsApp send policy and canary (homologation)

Every provider call goes through one gate (`lib/notifications/send-authorization.ts`), right before
the HTTP request, for all paths (worker, retries, inline `after()`, password recovery, replay):

- production: `WHATSAPP_ENABLED=true`, healthy configuration, `WHATSAPP_INSTANCE_ID` equal to
  `PRODUCTION_EVOLUTION_INSTANCE_ID`, no canary flag;
- homologation: only inside an active canary round, only to its allowlist;
- any other `APP_ENV`: never.

The business has one WhatsApp number, so a canary round uses the production instance. Start a round
by adding to staging `app.env` (all required), then `$C up -d app`:

```sh
WHATSAPP_ENABLED=true
WHATSAPP_CANARY_ENABLED=true
WHATSAPP_CANARY_ROUND_ID=canary-YYYYMMDD-01      # new id per authorized round
WHATSAPP_CANARY_INSTANCE_ID=<instance>           # must equal WHATSAPP_INSTANCE_ID
WHATSAPP_CANARY_EXPIRES_AT=<ISO-8601 with offset, at most 24 h ahead>
WHATSAPP_CANARY_MAX_MESSAGES=<authorized budget, max 20>
WHATSAPP_CANARY_ALLOWLIST=<number>,<number>      # literal numbers, max 5, no wildcards
```

The budget is a database counter (`OperationalHeartbeat` row `whatsapp-canary:<round>`), shared by all
workers and kept across restarts. Blocked sends are logged as `whatsapp.send_blocked` with a masked
recipient and settle the delivery as `DEAD/send_blocked`. End the round with `WHATSAPP_ENABLED=false`
and `WHATSAPP_CANARY_ENABLED=false`, `$C up -d app`, then confirm the outbox has no `PENDING`/`RETRY` rows.

### Evolution API requirements (learned in the 2026-11-17/18 incident)

- WhatsApp has moved most contacts to LID addressing. Evolution v2.3.2 (Baileys 6.7.19) and the
  official v2.3.7 image (Baileys 7.0.0-rc.9) left API messages as "Aguardando mensagem" on the
  recipient's phone. Both Baileys versions are also affected by the critical advisory
  GHSA-qvv5-jq5g-4cgg (fixed in 7.0.0-rc12). The VPS runs `local/evolution-api:2.3.7-baileys-rc14`,
  built from tag `2.3.7` (commit `cd800f29`) with only the `baileys` dependency pinned to `7.0.0-rc14`
  (`/opt/build/evolution-2.3.7-rc14`). No official stable image ships rc12+ yet.
- Images and recipes are preserved in `/root/backups/evolution-images/` (`docker save` archives, the
  `package.json`/lockfile patch, the base commit, the pinned Node base digest, `SHA256SUMS`); restore with
  `docker load < <file>.image.tar.gz`. The daily host prune removes unused images older than 24 h, so the
  archives, not the local tags, are the rollback source.
- Prepared, **not deployed**: `local/evolution-api:2.3.7-baileys-rc14-sec1` adds npm `overrides`
  `proxy-addr@2.0.8` (GHSA-jqcg-44mw-7w3h, critical) and `fast-xml-parser@5.12.1` (GHSA-m7jm-9gc2-mpf2 and
  related, critical). `npm audit --omit=dev`: 0 critical (was 2). Isolated test on a copy of the Evolution
  database passed. Effective exposure of both on the running image is low (Express `trust proxy` unset;
  XML parsing only through S3/MinIO, `S3_ENABLED=false`), so applying it is a scheduled change, not an emergency:
  `docker service update --no-resolve-image --image local/evolution-api:2.3.7-baileys-rc14-sec1 evolotion_evolution_v2`,
  then check `open` state and one inbound message; roll back to `...-baileys-rc14` the same way.
- With `CACHE_REDIS_ENABLED=true`, Evolution keeps the Signal keys (sessions, pre-keys, sender keys,
  LID mappings) in Redis hash `evolution:instance:<instanceId>` and only `creds` in Postgres. Pairing
  again with **Connect** keeps the old Redis keys under new creds, which produces unreadable
  messages. To re-pair, always use the official logout first (`DELETE /instance/logout/<instance>`,
  which clears both), then connect; the pairing code (`/instance/connect/<instance>?number=<owner>`)
  works when the Manager is not reachable.
- HTTP 201 and `PENDING` prove nothing: check `MessageUpdate` for `SERVER_ACK`/`DELIVERY_ACK` and that
  inbound messages are being stored, and confirm readability on a real phone.
- Staging reaches Evolution through `evolution.mi7anda.cloud`. While that DNS zone is unavailable, the
  staging stack adds `compose.dns-workaround.yml` (`extra_hosts` to the VPS IP, real certificate still
  verified); remove it when DNS resolves again.

## Database migrations (separate step, production needs GO)

The containers never run migrations. With GO and a verified backup, from a checkout of the approved SHA
with the target `DIRECT_URL` only in the shell:

```sh
npx prisma migrate status            # must list only the expected pending migration(s)
npx prisma migrate deploy
npx prisma migrate status            # "Database schema is up to date"
```

The P0 release adds one additive migration, `20261107120000_add_password_reset_challenge`
(new table + indexes + RLS). Rolling back the app does not require dropping it.

## Backup and restore (PostgreSQL 15 on Supabase)

The Supabase Free plan has no managed backups or PITR. Before any production migration, from the
operator workstation (production credentials never go to the VPS before cutover):

```sh
# client major = server major (15); session pooler or direct URL, never the transaction pooler
docker run --rm -e PGURL="$DIRECT_URL" -v "$BACKUP_DIR":/backup postgres:15 \
  sh -c 'pg_dump "$PGURL" --format=custom --schema=public --no-owner --no-privileges --file=/backup/alfa-prod-<UTC>.dump'
gpg --batch --symmetric --cipher-algo AES256 --passphrase-file <key-file> -o alfa-prod-<UTC>.dump.gpg alfa-prod-<UTC>.dump
sha256sum alfa-prod-<UTC>.dump.gpg > alfa-prod-<UTC>.dump.gpg.sha256
# delete the plaintext dump after the restore test; copy only the .gpg off-host (VPS /var/backups/alfa-cabelos, mode 600)
```

A backup counts only after a restore test with matching row counts and migration list. The dump
recreates schema `public`, so restore into a fresh database without it:

```sh
docker run -d --name alfa-restore-test -e POSTGRES_PASSWORD=restore postgres:15
docker exec alfa-restore-test psql -qU postgres \
  -c "CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;" \
  -c "CREATE DATABASE restore" -c "\c restore" -c "DROP SCHEMA public CASCADE"
gpg --batch --pinentry-mode loopback --passphrase-file <key-file> -d -o restore.dump alfa-prod-<UTC>.dump.gpg
docker cp restore.dump alfa-restore-test:/tmp/backup.dump
docker exec alfa-restore-test pg_restore -U postgres -d restore --no-owner --exit-on-error /tmp/backup.dump
docker exec alfa-restore-test psql -U postgres -d restore -c 'SELECT count(*) FROM "_prisma_migrations"'
docker rm -f alfa-restore-test && rm restore.dump
```
Dumps contain personal data: never in Git, chat or tickets. Keep the passphrase in the operator's
password manager; without it the backup is unrecoverable.

## Rollback

1. App: `sed -i "s/^APP_VERSION=.*/APP_VERSION=<previous sha>/" deploy.env && $C up -d`, or
   `mv src src.bad && mv src.prev src` for compose/config changes. Check `/api/ready`.
   **The host prunes unused images daily** (`/etc/cron.d/docker-image-prune`: `docker image prune -af
   --filter until=24h` at 00:24 UTC), so the previous tag may be gone. Before each deploy run
   `docker save alfa-cabelos:<current sha> | gzip -1 > /root/backups/alfa-images/<sha>.tar.gz`, or rebuild
   the previous SHA from `git archive` (the build is reproducible: pinned lockfile, no secrets at build time).
2. WhatsApp: `WHATSAPP_ENABLED=false` in `app.env`, `$C up -d app`.
3. Scheduler: `$C stop scheduler` (the outbox waits; stale rows expire by policy).
4. Proxy: remove the site link, `nginx -t && systemctl reload nginx`.
5. DNS: restore the previous record (operator); TTL defines how fast clients return.
6. Database: the P0 migration is additive and stays. A data restore needs its own GO and the verified backup.
7. While traffic is still on Vercel, rollback is a Vercel promote of the previous production deployment.

## Domain and cutover from Vercel (needs GO and the purchased domain)

Plan: production on the apex/`www` domain, homologation on `homolog.<domain>` (noindex header,
`robots.txt` disallows everything outside `APP_ENV=production`).

1. DNS (operator): `A <domain>` and `A homolog.<domain>` → VPS IPv4; optional `www` CNAME; low TTL (300 s) before cutover.
2. Homologation: certificate + site + `APP_URL=https://homolog.<domain>`; run the browser suite against it.
3. Production `app.env` with **new** secrets (`CRON_SECRET`, `PASSWORD_RESET_SECRET`, Evolution instance
   token); never copy homologation values. `WHATSAPP_ENABLED=false` at first.
4. Backup (verified restore) → migration `20261107120000_add_password_reset_challenge` → deploy → `/api/ready`.
5. Turn off the Vercel cron (`vercel.json` crons / project settings) and Vercel `WHATSAPP_ENABLED`
   **before** setting `WHATSAPP_ENABLED=true` here, so only one scheduler sends.
6. Point the domain to the VPS; verify login, booking, recovery and `/api/ready` on the public URL.
7. `alfacabelos.vercel.app` cannot be redirected by DNS: keep the Vercel project serving a redirect
   or notice to the new domain; keep it available until the VPS has run cleanly for the agreed period.
