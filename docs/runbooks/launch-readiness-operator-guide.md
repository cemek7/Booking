# Launch-Readiness Operator Guide

**Date:** 2026-07-03 · **Audience:** owner / ops / counsel.
Covers the remaining launch-readiness items that need account setup, legal input, or ops config —
plus the two engineering artifacts (backup/DR runbook, rate-limit audit) produced here.

---

## #6 — PostHog / Sentry / Linear accounts + keys (code is wired & inert)

All three are already integrated in code; they stay off until keys are present. For each: create the
project, copy the key, put it in your deploy env (and `.env.local` for local), redeploy.

### Sentry (error tracking)
1. sentry.io → create org + a **Next.js** project.
2. Set env: `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` (same DSN), `SENTRY_ORG`, `SENTRY_PROJECT`.
3. For source-map upload in CI, add `SENTRY_AUTH_TOKEN` (org auth token, `project:releases` scope).
4. Verify: trigger a test error; it should appear in Sentry. PII is scrubbed (`sendDefaultPii:false`).

### PostHog (product analytics + session replay)
1. posthog.com → project → Project Settings.
2. Set env: `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` (`https://eu.i.posthog.com` for EU
   data residency — recommended given GDPR, or `https://us.i.posthog.com`).
3. Verify: accept the cookie banner in-app, navigate; events should appear. Nothing fires pre-consent.
   Session replay masks all text/inputs.

### Linear (issue tracking) — no code dependency / no app env
Follow `docs/superpowers/plans/2026-06-11-linear-setup-checklist.md`: create teams/projects, connect
GitHub, define severity labels + intake template, import the launch-readiness items.

**Done when:** the three env groups are set in production and each tool shows live data.

---

## #7 — Counsel review + fill legal constants

The 10 legal/policy pages (`/privacy /terms /cookies /refunds /acceptable-use /ugc-policy /dpa
/sub-processors /accessibility /data-retention`) are **drafts** with a visible "pending legal review"
banner. Two steps:

1. **Fill `src/lib/legal/constants.ts`** (a dev change, ~5 min): replace the `TODO` placeholders —
   `entity` (registered legal entity name + form), registered address, and the `privacy@ / legal@ /
   support@` email addresses (confirm these mailboxes exist and are monitored).
2. **Counsel review** — have qualified counsel (or a reputable generator: Termly/iubenda/Osano) review,
   focusing on: the tenant-as-Merchant-of-Record framing (refunds/tax on the tenant), the prepaid
   non-refundable AI-credit terms, GDPR/NDPA obligations, the DPA + sub-processor list, and the
   "no EU Art. 27 representative yet" statement. Confirm whether an EU/UK representative is now needed.
3. When approved, **remove the draft banner** (`src/components/legal/LegalDocument.tsx`, the amber
   `role="note"` block).

**Done when:** constants filled, counsel sign-off, banner removed.

---

## #8 remaining items

### 8a — Pricing surfacing (BLOCKED: billing UI)
Surface AI-credit unit price + wallet balance + top-up in-product (transparency for the prepaid-credit
model). Blocked because the billing UI is another session's active surface. **When unblocked:** add a
balance/price panel to `dashboard/billing` reading the `ai_wallet` summary (already in
`src/lib/billing/ai-wallet.ts`); show unit `token_rate`, current `balance_credits`, low-balance
threshold, and a top-up CTA. Small, additive — spec it once the billing surface settles.

### 8b — Vendor sub-processor DPAs on file (OPS/LEGAL)
Countersign/obtain a DPA from each sub-processor listed on `/sub-processors`, store centrally:
- Supabase, Stripe, Paystack, SendGrid/Twilio, Meta (WhatsApp/Instagram), Google, PostHog, Sentry, the
  LLM provider(s), Evolution/WAHA host.
For each: locate their DPA (usually self-serve in the dashboard/legal portal), execute it, file the
signed copy, and record the date. **Done when:** every sub-processor on the page has a signed DPA on
file.

### 8c — Backup / DR runbook (needs your Supabase config — runbook below)
See the **Backup & Disaster Recovery** section at the end. It needs you to confirm PITR + fill RPO/RTO.

### 8d — Broader rate-limit audit (findings below)
Public endpoints audited 2026-07-03. Add IP rate-limiting (reuse the `isRedisConfigured` + `cacheGet`/
`cacheSet` pattern from `public/[slug]/reviews` and `reviews/[id]/flag`) to:

| Endpoint | Priority | Why |
|---|---|---|
| `public/[slug]/book` | **High** | Booking creation — spam/abuse creates junk reservations + notifications |
| `auth/finish` | **High** | Auth endpoint — throttle to slow credential abuse |
| `public/[slug]/availability`, `/services`, `/faqs`, `/[slug]` | Medium | Public reads — scraping / load |
| `email/unsubscribe`, `forms/schema` | Low | Token-verified / low-value |

**Not rate-limit targets (correct as-is):** `payments/{webhook,stripe,paystack}` (guarded by signature
verification — don't throttle legit webhooks), `jobs/auto-cancel-unconfirmed` (CRON_SECRET), `health`/
`ready`/`reviews*` (already limited). This is a small, low-risk engineering task (each route: ~10 lines,
mirror the existing pattern) — schedulable whenever a session owns those files.

---

## Backup & Disaster Recovery runbook

**Status:** template — fill the TODOs with your production Supabase settings.

### Backups
- **Database:** Supabase **Point-in-Time Recovery (PITR)**. **TODO:** confirm PITR is enabled on the
  production project (Supabase dashboard → Database → Backups) and record the **retention window**
  (Pro: up to 7 days; larger tiers longer). Daily logical backups are also taken by Supabase.
- **File storage:** Supabase Storage buckets — **TODO:** confirm backup/replication expectations for
  any customer media (`whatsapp_media`, etc.).
- **Off-site (optional):** the deferred R2 nightly export (env `R2_*` in `env.example`) can add an
  independent copy — enable if you want backups outside Supabase.

### Targets (fill in)
- **RPO (max data loss):** TODO (e.g. ≤ 5 min with PITR).
- **RTO (max downtime to restore):** TODO (e.g. ≤ 2 h).

### Restore drill (do once before launch, then quarterly)
1. In a **staging** project, restore from PITR to a timestamp ~1 h ago.
2. Verify row counts on core tables (`tenants`, `reservations`, `transactions`, `customers`).
3. Point a staging app at it; smoke-test a booking + a deposit.
4. Record elapsed time (informs RTO) and any gaps. File the result under `docs/runbooks/`.

### On a real data-loss incident
Follow `docs/runbooks/incident-response-and-breach-notification.md` §5 (Recovery): restore from the
latest clean PITR point, verify integrity + that the root cause is fixed before reopening access; if
personal data was affected, run the breach-notification steps.

**Done when:** PITR confirmed, RPO/RTO filled, one restore drill completed and logged.

---

## Quick status
| Item | Owner | Blocker |
|---|---|---|
| #6 accounts/keys | you | accounts |
| #7 counsel + constants | you + counsel | legal sign-off |
| 8a pricing surfacing | eng | billing UI (other session) |
| 8b vendor DPAs | ops/legal | execution |
| 8c backup/DR | you | confirm PITR + fill RPO/RTO (this doc) |
| 8d rate-limit audit | eng | schedule (findings above) |
