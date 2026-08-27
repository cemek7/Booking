# Prod promotion — deploy prompts, LIVE secrets, callback registration

**Date:** 2026-08-27 · **Prod branch:** `main` · **Prod image:** `ghcr.io/cemek7/booking`
**Prod host (canonical):** pick ONE and use it everywhere below — the repo mixes
`techclave.cloud`/`www.techclave.cloud` (nginx `server_name`) and `app.techclave.cloud`.
This guide writes `https://<PROD_HOST>` — substitute your choice consistently.

---

## 0. What this promotion ships (self-review)

staging→main is **28 commits, 55 files, +7,758 lines** — not just the two fixes. The bulk is the
**operating-loop / conversational-onboarding** feature from other sessions. Assessment:

- **Migrations (run against prod DB): security-solid.** RLS enabled on every new table, least-privilege
  GRANT/REVOKE, `SECURITY DEFINER` functions revoked from `PUBLIC`/`anon`/`authenticated` and granted only to
  `service_role`. ⚠️ **`042_operating_loop.sql` is NOT idempotent** (plain `CREATE TABLE` ×5) — run once.
- **Automation safety: approval-gated.** The loop **cannot** auto-message customers — objectives that would
  reach out throw `"This objective requires owner approval and cannot be automated"`; delivery flows through a
  governed outbox + worker. Promotion will not unleash outreach on real tenants on its own.
- **Build/boundary: green.** The staging build is fixed (server/client split) and a full `next build`
  compiled every route — no other `next/headers` leaks.
- **My two commits** (`43f89c8` security `@ts-nocheck` fix, `e931c73` onboarding build fix) reviewed & sound.
- **Non-blocking debt:** `src/types/unified-auth.ts` has a dead `import { cookies }` (comment-only use).

**Verdict:** no code blocker to promote. Gate is operational (§2–§4 below).

---

## 1. Migrations — did Claude add any? NO.

Neither of my commits touches `.sql`. **I created zero migrations.** The only migrations this promotion needs
that `main` lacks are the four pre-existing ones from the other feats:

```
supabase/migrations/042_operating_loop.sql                 # NOT idempotent — apply once
supabase/migrations/043_operating_loop_delivery_safety.sql
supabase/migrations/044_operating_loop_delivery_worker.sql
db/migrations/138_harden_retail_sale_functions.sql
```

If the "migrations for the other feats" you already ran on prod **included 042–044 + 138**, the DB is ready —
**do not re-run 042.** If not, apply the missing ones once, in order, against the prod `DATABASE_URL` (take a
backup first).

---

## 2. Prod LIVE secrets + APP_URL — what and how

**What it is:** the prod container reads its config from an env file (built from `.env.example`, 111 keys).
Two failure classes if wrong: (a) `APP_URL`/`NEXTAUTH_URL` unset → many routes fall back to
`http://localhost:3000`, breaking OAuth redirects and webhook self-calls; (b) **test** payment keys in prod →
real charges silently fail / no money moves.

**How:** on the VPS, edit the prod env file (the one `deployment/docker-compose.production.yml` loads) and set:

```bash
# --- Host (use your ONE canonical prod host, https) ---
APP_URL=https://<PROD_HOST>
NEXT_PUBLIC_APP_URL=https://<PROD_HOST>
NEXTAUTH_URL=https://<PROD_HOST>

# --- Supabase (PROD project — not staging) ---
NEXT_PUBLIC_SUPABASE_URL=https://<prod-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<prod anon key>
SUPABASE_URL=https://<prod-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<prod service-role key>
DATABASE_URL=<prod pooled connection string>
DIRECT_URL=<prod direct connection string>

# --- Secrets ---
NEXTAUTH_SECRET=<32+ random bytes>
ENCRYPTION_KEY=<required — column encryption>
CRON_SECRET=<random>
REDIS_URL=redis://:<redis-password>@127.0.0.1:6379/0
REDIS_ENABLED=true

# --- Payments: LIVE keys, NOT sk_test_/pk_test_ ---
PAYSTACK_SECRET_KEY=sk_live_...
PAYSTACK_PUBLIC_KEY=pk_live_...
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLIC_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_<from the prod webhook you create in §3>

# --- Channels (only if enabling in prod) ---
GOOGLE_CLIENT_ID=...            GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=https://<PROD_HOST>/api/calendar/callback
WHATSAPP_ACCESS_TOKEN=...       WHATSAPP_PHONE_NUMBER_ID=...
WHATSAPP_APP_SECRET=...         WHATSAPP_WEBHOOK_VERIFY_TOKEN=...
INSTAGRAM_WEBHOOK_VERIFY_TOKEN=...
```

Quick sanity check after editing (no test keys, host is https):

```bash
grep -E '^(APP_URL|NEXTAUTH_URL|PAYSTACK_SECRET_KEY|STRIPE_SECRET_KEY)=' .env.production
grep -Eq 'sk_test_|pk_test_|localhost' .env.production && echo "⚠️ TEST KEY OR LOCALHOST STILL PRESENT" || echo "ok"
```

---

## 3. Register the prod host with each provider — what and how

**What it is:** OAuth logins and inbound webhooks only work if the provider has your **prod** URL on its
allow-list. These live in each provider's dashboard, **outside the repo** — code can't set them. Skip a
provider you are not enabling yet.

| Provider | Where | Value to register |
|---|---|---|
| **Supabase Auth** | Dashboard → Authentication → URL Configuration → Redirect URLs | `https://<PROD_HOST>/api/auth/callback`, `https://<PROD_HOST>/auth/callback`, `https://<PROD_HOST>/booka/auth/callback`; Site URL = `https://<PROD_HOST>` |
| **Google** (Calendar) | Cloud Console → Credentials → OAuth client → Authorized redirect URIs | `https://<PROD_HOST>/api/calendar/callback` |
| **Meta / WhatsApp Cloud** | Meta App → WhatsApp → Configuration → Webhook | Callback `https://<PROD_HOST>/api/webhooks/whatsapp/meta`, Verify token = `WHATSAPP_WEBHOOK_VERIFY_TOKEN` |
| **Per-tenant WhatsApp** | (same, if used) | `https://<PROD_HOST>/api/webhooks/whatsapp/<tenantId>` |
| **Instagram** | Meta App → Instagram → Webhooks + OAuth redirect | Webhook `https://<PROD_HOST>/api/webhooks/instagram` (verify token `INSTAGRAM_WEBHOOK_VERIFY_TOKEN`); OAuth redirect `https://<PROD_HOST>/api/auth/instagram/callback` |
| **Stripe** | Dashboard (LIVE mode) → Developers → Webhooks → Add endpoint | `https://<PROD_HOST>/api/payments/stripe` → copy signing secret into `STRIPE_WEBHOOK_SECRET` (§2) |
| **Paystack** | Dashboard (LIVE) → Settings → API Keys & Webhooks | Webhook URL `https://<PROD_HOST>/api/payments/paystack` (verifies `x-paystack-signature`) |

After changing env, restart the container (§4) so it picks up the new values.

---

## 4. Deploy — it's automatic (no manual pull)

This VPS deploys itself. Stack lives at **`/opt/techclave/prod`** (compose `docker-compose.yml`, app image
`${APP_IMAGE}`, env `/opt/techclave/prod/.env`). A systemd timer **`booka-production-image-refresh.timer`**
runs every 5 min: it polls `origin/main`, waits for `ghcr.io/cemek7/booking:production-<full-SHA>` to publish,
pins that immutable tag in prod `.env`, pulls it, recreates the app **only if the image changed**, and
health-checks. There is **no manual `docker compose pull`** step.

**Consequence for env changes:** editing `.env` alone does **not** trigger a recreate (the timer only acts on
an image change). So put all LIVE secrets (§2) in place **before** the merge — the post-merge image swap will
recreate the container with them. If you must add/change a secret *without* an image change, force one recreate:

```bash
cd /opt/techclave/prod
docker compose up -d --force-recreate <app-service-name>   # service that runs booka-prod-app; then health-check
```

### Go-live flow

1. Ensure prod `.env` has the LIVE secrets you need (§2) and callbacks are registered (§3).
2. Merge the staging→main PR. On `main`, confirm the **`VPS Deploy`** job goes green (it publishes the image).
   The separate `🚀 Production Deployment Pipeline` job has failed on past `main` pushes and does **not** gate
   the image or the timer — only `VPS Deploy` matters.
3. Within ~5 min the timer pins + pulls the new `production-<SHA>` and recreates the app. Watch:
   `systemctl status booka-production-image-refresh.service` and `docker ps --format '{{.Image}}\t{{.Status}}'`.

### Post-deploy smoke tests

```bash
curl -fsS  https://booka.app.techclave.cloud/api/health   && echo OK      # app up
curl -fsS  https://booka.app.techclave.cloud/api/ready    && echo READY   # redis-gated readiness
curl -sI   https://booka.app.techclave.cloud/             | head -1       # 200 Techclave landing
curl -sI   https://booka.app.techclave.cloud/booka        | head -1       # 200 Booka
curl -sI   https://booka.app.techclave.cloud/showcase     | head -1       # 200 showcase
curl -sI   https://booka.app.techclave.cloud/dashboard    | head -1       # 308 -> /booka/dashboard
```

Then in a browser: sign in as an owner → lands on `/booka/dashboard`; one small **LIVE** payment → succeeds +
webhook recorded.

### Rollback

The timer follows `main`, so **revert on `main`** to roll back (it will pull the reverted image within 5 min),
or pin the prior image by hand and recreate:

```bash
cd /opt/techclave/prod
# set APP_IMAGE=ghcr.io/cemek7/booking:production-a55399828431f3731b8cee0e7e9d641c1133a3e7 (current known-good) in .env
docker compose up -d --force-recreate <app-service-name>
```
(DB is already migrated for this promotion; a rollback is image/config only.)

---

## 5. Order of operations

1. ~~Migrations~~ **Already applied on prod** — `onboarding_evidence` + `operating_delivery_outbox` exist,
   confirming 042–044 landed (042 is a no-op there now); 138 is GRANT-only. Nothing to run.
2. Put the LIVE secrets in prod `/opt/techclave/prod/.env` **before** the merge (§2), because an env-only edit
   won't recreate the container — the post-merge image swap will. Host vars already set to
   `booka.app.techclave.cloud`. Still needed: `DIRECT_URL`, Paystack LIVE, Stripe LIVE (+webhook), Google id/secret.
3. Register prod callbacks with each provider you're enabling (§3). Keep the `app.techclave.cloud` Supabase
   redirects too, as a rollback host.
4. Open + merge the staging→main PR (ask Claude to open it when you're ready).
5. Confirm the `VPS Deploy` job on `main` is green; the 5-min timer then auto-pulls + recreates (§4). No manual
   deploy.
6. Run smoke tests (§4). Roll back by reverting `main` (or pinning the prior image) if needed.
