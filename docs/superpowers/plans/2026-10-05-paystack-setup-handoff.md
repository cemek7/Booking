# Paystack Settlement — Go-Live Handoff (2026-10-05)

Handoff from a Claude Code session to the next agent (Codex). Read this first, then the spec.

## Where things stand

- **Code:** unified Paystack settlement is merged to `origin/staging` at `e548c18` (25 commits from `1759338`). Production (`origin/main`) is still at `5cb5e3d` (2026-09-23) — **no settlement code in prod**.
- **Deployed:** the push auto-ran GitHub Actions "VPS Deploy" for staging (run 37164029897, success). `https://staging.app.techclave.cloud/api/health` → 200. `POST /api/payments/webhook` unsigned → 400 (correct).
- **Database:** owner ran migration 160 on a Supabase project and the verifier returned 13/13 `true`. **Unconfirmed which project (staging or production).** Ask the owner.
- **Tests at e548c18:** full suite 406 suites / 3034 tests passed, 0 failed.
- **Collection gate:** nothing collects money until `BOOKA_TENANT_PAYMENTS=live` is set in that environment.

## Key references

- Spec (authority, owner decisions §13): `docs/superpowers/specs/2026-10-02-unified-paystack-settlement-design.md`
- Plan: `docs/superpowers/plans/2026-10-02-unified-paystack-settlement.md`
- Every decision/ruling made during the build (R1–R28 + parked items): `docs/superpowers/plans/2026-10-02-unified-paystack-settlement-ledger.md`
- Final-review fixes: `docs/superpowers/plans/2026-10-02-unified-paystack-settlement-final-fixes.md`
- Migration: `db/migrations/160_unified_paystack_settlement.sql` (+ `_verify.sql`, `_manual_fallback.md`)
- Ops guide section "Customer payment settlement": `docs/operations-guide.md`
- Core code: `src/lib/payments/tenantSettlement.ts`, `src/lib/payments/paystackWebhookProcessor.ts`, `src/app/api/payments/subaccounts/route.ts`

## Commercial policy (owner-approved)

1% Booka fee, capped at NGN 2,000 per transaction (`pilot_ngn_v1` v1). Tenant bears Paystack fees (`bearer: subaccount`). Fail closed when settlement is missing. Full Booka-initiated refunds return Booka's fee; partial refunds keep it. Payment handoffs are exempt from auto-cancel. Daily close reports gross plus fee lines.

## Remaining work — do in order

### Part A — Staging (Paystack Test Mode)
1. **Paystack dashboard (Test Mode)** → Settings → API Keys & Webhooks: copy `sk_test_…` / `pk_test_…`; set **Test Webhook URL** = `https://staging.app.techclave.cloud/api/payments/webhook`; Save. (Webhook signature uses the secret key; there is no separate webhook secret.) Do NOT create subaccounts by hand.
2. **Staging server `.env.production`:** `PAYSTACK_SECRET_KEY=sk_test_…`, `PAYSTACK_PUBLIC_KEY=pk_test_…`, `BOOKA_TENANT_PAYMENTS=live` → `pm2 reload boka`.
3. **Staging app** as the pilot salon owner → Settings → Payments: bank + account number, tick fee acceptance, Save → status must be **Active**.
4. **Three test payments** (Paystack test card from Paystack's test-mode docs): booking deposit, retail order, payment link. Each must end **confirmed / paid** (subject state changes, not just the transaction row). Replay one webhook from the Paystack dashboard and confirm no second effect.

### Part B — Production (only after Part A passes)
1. Run migration 160 + verifier on the **production** DB if not already applied (pre-checks in the commands below).
2. Paystack **Live Mode**: live keys; Live Webhook URL = `https://<prod-host>/api/payments/webhook`.
3. Promote `staging` → `main` (fast-forward); push triggers the production VPS deploy.
4. Production env: live keys + `BOOKA_TENANT_PAYMENTS=live` → reload; run one real NGN 100 payment and confirm settlement split, Booka fee, ledger row.

## Migration commands (owner runs these; agents never run migrations against real DBs)

Pre-checks (read-only):
```sql
SELECT count(*) AS has_reason_code FROM information_schema.columns WHERE table_name='escalation_queue' AND column_name='reason_code';
SELECT count(*) AS has_ledger_index FROM pg_indexes WHERE indexname='idx_tenant_revenue_ledger_unique_ref';
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.transactions'::regclass AND pg_get_constraintdef(oid) ILIKE '%subject_type%';
SELECT count(*) AS legacy_subaccounts FROM public.tenants WHERE metadata ? 'paystack_subaccount_code';
```
Stop if has_reason_code=0, has_ledger_index=0, or legacy_subaccounts>0.
Run: `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/160_unified_paystack_settlement.sql`
Verify: `psql "$DATABASE_URL" -At -f db/migrations/160_unified_paystack_settlement_verify.sql` — every row true.

## Open questions for the owner
1. Which Supabase project got migration 160 — staging or production?
2. Production host for the Live Webhook URL.

## Known parked risks (money-safe; watch during Part A)
- A customer confirmation could be sent twice in a rare concurrent retry.
- After a Booka-recorded partial refund, a smaller Paystack-dashboard partial refund is treated as already recorded.
- Staff marking a retail order paid by hand, then the webhook arriving, raises a false double-payment escalation.
- Paystack's `transaction_charge` unit and zero-value behaviour, and the `fees_split` shape, are unverified — confirm in Part A step 4 by inspecting the transaction split in the Paystack dashboard.

## Rules (from repo CLAUDE.md and owner)
- One worktree per branch; never checkout/switch in shared dirs. Cross-branch work via throwaway worktree.
- `git fetch origin` first. Fast-forward only; never force-push.
- Never modify Supabase/Paystack/VPS yourself; never print env values.
- Untracked `docs/runbooks/staging-owner-smoke-handoff-2026-09-15.md` belongs to the owner — leave it.

## Side note
PR #105 (`feat/landing-visual-refresh`): accessibility review comment fixed in `eeb7944` and pushed. The `worktrees/landing-refresh` worktree is one commit behind — `git pull --ff-only` there before editing.
