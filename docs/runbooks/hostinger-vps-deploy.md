# Boka — Hostinger VPS Deploy Runbook

**Launch base:** `release/vps-launch-ready` (cut from `feat/instagram-channel`, which builds clean in
production). Host: **Hostinger VPS**, no Vercel — the app runs under **pm2** and is scheduled by **system
cron**. `vercel.json` was removed because Vercel Cron does not exist here; its five schedules moved to
`deployment/vps-crontab.txt`.

---

## 0. What "the other needed files" are (all on this branch)
- `deployment/ecosystem.config.cjs` — pm2 process definition for the Next.js app.
- `deployment/vps-crontab.txt` — the 5 scheduled jobs that `vercel.json` used to fire (see the table below).
- `env.example` — source for `.env.production` (created on the VPS; **secrets are never committed**).

### Cron parity with the old vercel.json
| Job | Schedule | Auth header |
|---|---|---|
| `/api/jobs/process` | every minute | `x-cron-secret: $CRON_SECRET` |
| `/api/jobs/auto-cancel-unconfirmed` | every 15 min | `x-cron-secret: $CRON_SECRET` |
| `/api/worker/whatsapp` | every minute | `Authorization: Bearer $CRON_SECRET` |
| `/api/cron/nightly` | 22:00 daily | `Authorization: Bearer $CRON_SECRET` |
| `/api/cron/reminders` | every 10 min | `Authorization: Bearer $CRON_SECRET` |

> **Reminders (fixed 2026-07-07):** the old `vercel.json` pointed at `/api/reminders/run`, which is
> session-auth (`{ auth: true, roles: [...] }`) and can't be driven by a cron secret — it was already
> 401-ing under Vercel Cron. Replaced with `/api/cron/reminders`, the all-tenants Bearer-auth counterpart
> that shares `runRemindersForTenant()` with the session route. `/api/reminders/run` remains for
> in-dashboard manual "run now" by an owner/manager.

---

## 1. Push the launch branch (run from this repo, only when authorized)
```bash
git push origin release/vps-launch-ready
```

## 2. Promote the SAME commit up the environments (fast-forward only — no rebuild drift)
```bash
SHA=$(git rev-parse release/vps-launch-ready)
for ENV in dev staging prod; do
  git branch -f "$ENV" "$SHA"
  git push origin "$ENV"
done
```
Every environment now points at one identical, build-verified commit.

## 3. On the Hostinger VPS — first deploy
```bash
cd /var/www/boka                 # repo checkout on the VPS
git fetch origin
git checkout prod                # or dev/staging for those boxes
git pull --ff-only origin prod

cp env.example .env.production   # ONLY the first time; then fill in real secrets
# Edit .env.production — see "Required env" below. CRON_SECRET must match step 4.

npm ci
npm run build                    # NODE_OPTIONS=4096 next build --webpack
pm2 start deployment/ecosystem.config.cjs
pm2 save && pm2 startup          # run the command pm2 prints, once, so boka survives reboot
```

### Redeploy (every subsequent release)
```bash
cd /var/www/boka
git pull --ff-only origin prod
npm ci
npm run build
pm2 reload boka                  # zero-downtime
```

## 4. Install the scheduler (replaces Vercel Cron)
```bash
cd /var/www/boka
# set APP_URL + CRON_SECRET at the top of the file first:
$EDITOR deployment/vps-crontab.txt
crontab deployment/vps-crontab.txt
crontab -l                       # verify the 4 lines are installed
```
`CRON_SECRET` here MUST equal `CRON_SECRET` in `.env.production`, or every job 401s.

## 5. Smoke tests (do these before announcing launch)
```bash
curl -fsS https://APP_URL/api/health                       # 200
# cron auth wired correctly:
curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" https://APP_URL/api/jobs/process
curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://APP_URL/api/worker/whatsapp
pm2 status                                                 # boka = online, low restarts
pm2 logs boka --lines 50                                   # no crash loops / missing-env errors
```
Then walk one real WhatsApp booking end-to-end.

---

## Required env (from `env.example` — fill in `.env.production` on the VPS)
Critical to boot / core flows:
- `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `CRON_SECRET` (must match `deployment/vps-crontab.txt`)
- Payments: `STRIPE_SECRET_KEY`, `STRIPE_PUBLIC_KEY`, `STRIPE_WEBHOOK_SECRET`, `PAYSTACK_SECRET_KEY`
- WhatsApp: Evolution API base URL + key
- Observability: `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`,
  `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`
- Linear has no app env in this repo; set it up as an external ops integration only

Run `npm run build` locally-clean is the true launch gate: focused test suites passing does not prove the
production build resolves every import. This branch is the one confirmed to build (`FEAT_EXIT=0`).

## Do NOT deploy `release/vps-launch` (the older candidate)
That branch's prune deleted files still imported at build time and dropped `ioredis`/`jszip`/`redis` from
`package.json` — it fails `npm run build`. Its focused tests passed only because they mock those paths.
`release/vps-launch-ready` is the buildable replacement.
