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

## 4. VPS deploy prompts (copy-paste)

Promotion `main` push builds `ghcr.io/cemek7/booking:production-<sha>` + `production-latest`. **The workflow
does NOT deploy** — pull on the VPS. Also note the `🚀 Production Deployment Pipeline` workflow has failed on
past `main` pushes; the image the `VPS Deploy` job builds is what you actually pull, so a red
Production-Pipeline run does not block the manual pull below — but check the `VPS Deploy` job went green.

```bash
# On the VPS
cd /opt/booka/Booking
git fetch origin && git checkout main && git pull --ff-only origin main   # sync compose/nginx/runbook files

# (first cutover only) take a prod DB backup, then apply the 4 missing migrations ONCE — see §1

export APP_IMAGE=ghcr.io/cemek7/booking:production-latest
docker compose -f deployment/docker-compose.production.yml pull
docker compose -f deployment/docker-compose.production.yml up -d
docker compose -f deployment/docker-compose.production.yml ps        # all healthy?
docker compose -f deployment/docker-compose.production.yml logs -f --tail=100 booka-production
```

Pin to an exact build instead of `-latest` (safer rollback target):

```bash
export APP_IMAGE=ghcr.io/cemek7/booking:production-<sha>   # the promoted commit's short sha
docker compose -f deployment/docker-compose.production.yml up -d
```

### Post-deploy smoke tests

```bash
curl -fsS  https://<PROD_HOST>/api/health   && echo OK      # app up
curl -fsS  https://<PROD_HOST>/api/ready    && echo READY   # redis-gated readiness
curl -sI   https://<PROD_HOST>/             | head -1       # 200 Techclave landing
curl -sI   https://<PROD_HOST>/booka        | head -1       # 200 Booka
curl -sI   https://<PROD_HOST>/showcase     | head -1       # 200 showcase
curl -sI   https://<PROD_HOST>/dashboard    | head -1       # 308 -> /booka/dashboard
```

Then in a browser: sign in as an owner → lands on `/booka/dashboard`; send one WhatsApp message to a connected
tenant → inbound webhook processes (check logs); one small **LIVE** payment → succeeds + webhook recorded.

### Rollback

```bash
export APP_IMAGE=ghcr.io/cemek7/booking:production-<previous-sha>
docker compose -f deployment/docker-compose.production.yml up -d
# DB: restore the pre-migration backup only if a migration caused breakage (config/callbacks are the usual culprit).
```

---

## 5. Order of operations

1. Confirm prod DB has migrations 042–044 + 138 (apply the missing ones once — §1).
2. Set prod LIVE secrets + `APP_URL` (§2).
3. Register prod callbacks with each provider you're enabling (§3).
4. Open + merge the staging→main PR (ask Claude to open it when you're ready).
5. Confirm the `VPS Deploy` job is green, then pull + restart on the VPS (§4).
6. Run smoke tests (§4). Roll back if needed.
