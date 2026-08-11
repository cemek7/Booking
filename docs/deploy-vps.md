# Deploying Booka to a VPS (`app.techclave.cloud`)

Booka's product and `/api/*` are served at `app.techclave.cloud`. The marketing site remains
at `techclave.cloud`; it is not a Meta callback origin. Once the Booka app is live, the
Instagram endpoints (`/api/webhooks/instagram`, `/api/auth/instagram/callback`) come up with
everything else.

## Architecture (dockerized)

`deployment/docker-compose.production.yml` runs:

| Container | Role |
|---|---|
| `booka-production` | the Next.js app (`:3000`) |
| `booka-nginx` | reverse proxy / TLS (`:80`, `:443`) — mounts `deployment/nginx/nginx.conf` + `deployment/nginx/ssl` |
| `booka-worker` | background worker (processes the WhatsApp/Instagram message queue) |
| `booka-redis` | cache/queue support |

- **Database is Supabase (cloud)**, configured via env — *not* the `postgres` container in
  the compose file (that one is vestigial; migrations go to Supabase).
- The **authoritative nginx config in production is `deployment/nginx/nginx.conf`** (it's the
  file the production compose mounts). `production.conf` is for the other compose variant.
- nginx reads `/etc/nginx/ssl/booka.crt` + `booka.key`, mounted from
  `deployment/nginx/ssl/`. `server_name` is `techclave.cloud www.techclave.cloud`.

## 1. DNS (Hostinger)

Point the domain at the VPS public IP:

```
A    @     <VPS_IP>
A    www   <VPS_IP>
```

Remove any parking/website-builder records. Confirm: `dig +short techclave.cloud` → `<VPS_IP>`.

## 2. VPS prerequisites

- Docker + Docker Compose plugin installed.
- Ports 80 and 443 open in the firewall.
- `git` installed; clone the repo and check out the deploy branch.

```bash
git clone <repo> booka && cd booka
git checkout <deploy-branch>
```

## 3. Production environment file

Create the env file the app reads (see `env.example` for the full list). Minimum for a
working deploy + Instagram:

```
NODE_ENV=production
APP_URL=https://app.techclave.cloud
NEXT_PUBLIC_BASE_URL=https://app.techclave.cloud

# Supabase (cloud DB + auth)
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
DATABASE_URL=...                      # must point at Supabase, NOT the local pg container

CRON_SECRET=<openssl rand -hex 32>

# Instagram (see docs/instagram-meta-setup-guide.md)
INSTAGRAM_APP_ID=...
INSTAGRAM_APP_SECRET=...
INSTAGRAM_WEBHOOK_VERIFY_TOKEN=booka_ig_verify_2026
INSTAGRAM_OAUTH_REDIRECT_URI=https://app.techclave.cloud/api/auth/instagram/callback
INSTAGRAM_OAUTH_STATE_SECRET=<openssl rand -hex 32>
```

## 4. TLS certificate

Use the standalone flow (the `--nginx` certbot plugin can't see the containerized nginx).
`setup-ssl.sh` stops the nginx container, issues via `certbot certonly --standalone`, copies
the cert into the mounted `deployment/nginx/ssl/`, and installs a renewal cron.

```bash
sudo DOMAIN=techclave.cloud EMAIL=you@techclave.cloud USE_LETSENCRYPT=true \
  deployment/scripts/setup-ssl.sh
```

DNS (step 1) must already resolve to this server, and port 80 must be free during issuance.
For local/testing without a public domain, omit `USE_LETSENCRYPT` for a self-signed cert.

## 5. Build and start

```bash
docker compose -f deployment/docker-compose.production.yml up -d --build
docker compose -f deployment/docker-compose.production.yml ps   # all healthy?
```

## 6. Apply database migrations (Supabase)

Run pending migrations against the Supabase DB (SQL editor or psql with the Supabase
`DATABASE_URL`). For the current Instagram work that means at least:

- `db/migrations/079_whatsapp_message_queue_channel.sql`
- `db/migrations/082_instagram_provider_secrets.sql`

> ⚠️ A migration-number collision exists (`079_finance_ledgers.sql` vs
> `079_whatsapp_message_queue_channel.sql`) from a separate refactor — renumber one before
> running migrations in filename order.

## 7. Verify

```bash
curl -fsS https://app.techclave.cloud/api/health     # should return OK from the app
```

Open `https://techclave.cloud/` (marketing) and `https://app.techclave.cloud/` (Booka).

## 8. Instagram / Meta

Now follow **`docs/instagram-meta-setup-guide.md`** — paste:

- Webhook callback `https://app.techclave.cloud/api/webhooks/instagram` + the verify token.
- Business-login redirect `https://app.techclave.cloud/api/auth/instagram/callback`.

## Operational notes

- **The worker must be running** for Instagram/WhatsApp replies — inbound messages are
  enqueued and `booka-worker` processes them. Check its logs if the AI never replies.
- **Cert renewal** runs at 03:00 daily via the cron `setup-ssl.sh` installed (stops nginx,
  renews, copies certs, restarts nginx).
- **Redeploy:** `git pull && docker compose -f deployment/docker-compose.production.yml up -d --build`.
- **Logs:** `docker compose -f deployment/docker-compose.production.yml logs -f booka-production`
  (or `booka-worker` / `booka-nginx`).
