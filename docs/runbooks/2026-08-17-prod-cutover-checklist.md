# Production cutover checklist — staging → prod

**Date:** 2026-08-17
**Context:** `main` (prod) is `0 ahead / 509 behind` `staging` — a clean fast-forward. CI (`typecheck:ci` +
`npm test`) is green on every recent staging push. There is **no code or CI blocker**. The gate is
operational: DB parity, prod secrets, and external callback registration. Work top to bottom.

> Supersedes the verdict in `docs/hard-launch-readiness-audit.md` (dated 2026-05-19), whose "No-Go"
> blockers — dirty worktree, no whole-repo typecheck, legacy surfaces — have been addressed since.

---

## 0. Pre-flight (local, read-only)

- [ ] `git fetch origin && git log --oneline origin/main..origin/staging | wc -l` — confirm the diff you expect.
- [ ] Confirm the canonical **prod host**. Prod nginx `server_name` = `techclave.cloud www.techclave.cloud`
      (`deployment/nginx/nginx.conf`), but some configs reference `app.techclave.cloud`. Pick one and make
      every item below (env `APP_URL`, TLS cert, OAuth/webhook callbacks) use it consistently.

## 1. Database parity — HIGHEST RISK

The live DB has a history of drifting from migrations → 500s on new pages. Prod is a **separate Supabase
project** from staging; its schema must match what the 509 new commits expect.

- [ ] Migrations are idempotent (per `CLAUDE.md`), so the safe move is to **re-apply all in order** against
      the prod DB, from **both** dirs: `db/migrations/` (122 files) and `supabase/migrations/` (27 files).
      Run against the prod `DATABASE_URL`/`DIRECT_URL`. **Never run against the live DB without a backup.**
- [ ] Spot-check drift before deploy (read-only) — recent feature migrations the new code depends on:
      ```sql
      -- reservations.source (2026-07-31_add_reservations_source.sql)
      select column_name from information_schema.columns
        where table_name='reservations' and column_name='source';
      -- tenants late columns (2026-07-30_add_missing_tenants_columns.sql)
      select column_name from information_schema.columns
        where table_name='tenants' order by column_name;
      -- staff/services + escalation (supabase/migrations 041, 039)
      select to_regclass('public.staff_services'), to_regclass('public.escalation_queue');
      -- products/retail subsystem (exists via migration only)
      select to_regclass('public.products');
      ```
      Any `NULL`/missing result = apply the owning migration before cutover.
- [ ] Take a **prod DB snapshot/backup** immediately before applying migrations (rollback safety).

## 2. Prod env / secrets

Authoritative var list: `.env.example` (144 entries). Build the prod `.env` from it. Critical:

- [ ] `APP_URL` / `NEXT_PUBLIC_APP_URL` / `NEXTAUTH_URL` = the prod host (https). Many routes fall back to
      `http://localhost:3000` if unset (`instagram/callback`, all `webhooks/*` worker calls, `auth/callback`).
- [ ] Supabase **prod project**: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
      `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`, `DATABASE_URL`, `DIRECT_URL`.
- [ ] **Payments — use LIVE keys, not test.** `PAYSTACK_SECRET_KEY`/`PAYSTACK_PUBLIC_KEY`,
      `STRIPE_SECRET_KEY`/`STRIPE_PUBLIC_KEY`/`STRIPE_WEBHOOK_SECRET`. A test key in prod = silent revenue loss.
- [ ] `REDIS_URL` (with password, per runbook §2), `REDIS_ENABLED=true`, `CRON_SECRET`, `NEXTAUTH_SECRET`.
- [ ] WhatsApp/Meta prod tokens (`EVOLUTION_API_*` or Meta), `INSTAGRAM_WEBHOOK_VERIFY_TOKEN`, `OPENROUTER_API_KEY`, SMTP.

## 3. External callback registration (outside the repo — code can't fix this)

Register the **prod** host with every provider or logins/webhooks fail silently:

- [ ] **Supabase Auth** → redirect allow-list: `https://<prod-host>/api/auth/callback`, `https://<prod-host>/booka/auth/callback`.
- [ ] **Meta / WhatsApp Cloud** webhook: `https://<prod-host>/api/webhooks/whatsapp/meta` (+ verify token).
- [ ] **Instagram** webhook: `https://<prod-host>/api/webhooks/instagram` (+ `INSTAGRAM_WEBHOOK_VERIFY_TOKEN`).
- [ ] Per-tenant WhatsApp: `https://<prod-host>/api/webhooks/whatsapp/[tenantId]`.
- [ ] **Google OAuth** (Calendar) redirect URI → prod host.
- [ ] **Stripe/Paystack** webhook endpoints → prod host, and paste the signing secret into env (§2).

## 4. TLS / domain

- [ ] DNS A record for the prod host → VPS IP.
- [ ] Cert issued for the prod host via `deployment/setup-ssl.sh` (standalone certbot; renewal cron installed).
      nginx mounts `deployment/nginx/ssl/booka.crt`/`booka.key`.

## 5. Promote + deploy

- [ ] Fast-forward prod branch: `git push origin origin/staging:main` (or open a staging→main PR and merge).
      This triggers `deploy-vps.yml` → builds `ghcr.io/cemek7/booking:production-<sha>` + `production-latest`.
      **The workflow does NOT deploy to the VPS** — it only builds the image.
- [ ] On the VPS, pull + restart (per `docs/vps-launch-runbook.md`):
      ```bash
      cd /opt/booka/Booking
      export APP_IMAGE=ghcr.io/cemek7/booking:production-latest
      docker compose -f deployment/docker-compose.production.yml pull
      docker compose -f deployment/docker-compose.production.yml up -d
      docker compose -f deployment/docker-compose.production.yml ps   # all healthy?
      ```
      (Note: the postgres service bundled in that compose is vestigial — the DB is Supabase, per `CLAUDE.md`.)

## 6. Post-deploy smoke tests

- [ ] `curl -fsS https://<prod-host>/api/health` → ok
- [ ] `curl -fsS https://<prod-host>/api/ready` → ok (Redis-gated readiness)
- [ ] `curl -sI https://<prod-host>/` → 200, Techclave landing
- [ ] `curl -sI https://<prod-host>/booka` and `/showcase` → 200
- [ ] `curl -sI https://<prod-host>/dashboard` → 308 → `/booka/dashboard`
- [ ] Sign in as an owner → lands on `/booka/dashboard` (no error, no bare `/dashboard`).
- [ ] Send one WhatsApp message to a connected tenant → inbound webhook processes (check logs).
- [ ] One real (small) payment in LIVE mode → success + webhook recorded.

## 7. Rollback

- [ ] `main` can be reset to the previous prod SHA, or redeploy the prior `production-<sha>` image tag.
- [ ] DB: restore the §1 snapshot if a migration caused breakage. (Migrations are additive/idempotent, so
      most issues are config, not schema — check env/callbacks first.)

---

## Known soft debt (not gating, address soon after)

- **33 prod files still carry `@ts-nocheck`** (type safety off). The last two removals uncovered **2 masked
  bugs in payment code** — prioritize clearing `@ts-nocheck` from the remaining payment/auth/encryption files.
- Legacy compatibility shims (WhatsApp webhook aliases, dual dashboard surfaces) remain by design; schedule a
  prune pass post-launch.
