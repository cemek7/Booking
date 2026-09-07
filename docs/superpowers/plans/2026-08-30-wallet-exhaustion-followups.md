# Wallet-exhaustion follow-ups — implementation plan

**Spec:** `docs/superpowers/specs/2026-08-30-wallet-exhaustion-followups-design.md`
**Branch:** `feat/wallet-exhaustion-followups` off `staging`
**Order:** Phase 1 → 2 → 3. Phases 1 and 2 are independent of Phase 3 and should ship first.
**Status:** Phase 1 Task 1.1 and **all of Phase 2** landed 2026-08-30. Task 1.2 needs a
product decision (handoff copy). Phase 3 (auto-recharge) open, gated on Task 3.1.

Migrations are plaintext, idempotent, RLS-aware, validated in a throwaway `postgres:16-alpine`
container. **The user runs migrations on the VPS.** Next free number is **144**.

---

## Phase 1 — Close the compliance residue (§3.2)

Small, and it removes an implicit assumption before anyone else changes the call graph.

### Task 1.1 — Assert the 24-hour service window before a handoff — ✅ DONE 2026-08-30

**Files:** `src/lib/billing/messageHandoff.ts`, `src/__tests__/lib/billing/messageHandoff.test.ts`

The handoff sends free-form text, which Meta permits only inside the customer-service window. It
is safe today only because a `chats` row implies a past inbound — a coincidence of the call graph,
not a check.

- Read `whatsapp_conversations.last_inbound_at` for `(tenant_id, phone_number)` alongside the
  existing opt-out lookup (same table — **fold it into one query**, do not add a second round trip).
- If absent or older than 24h, return a new reason `outside_service_window` and do not send.
- Fail toward sending when the lookup errors, matching the opt-out guard's rationale.

**Tests:** inside the window sends; 25h old does not send and returns `outside_service_window`;
a lookup error still sends. Each must fail if the guard is removed.

### Task 1.2 — Handoff copy

**Files:** `src/lib/billing/messageHandoff.ts`

`HANDOFF_TEXT` promises a team member "will reply to you here shortly". Booka cannot keep that
promise for a tenant with nobody watching the inbox. Either gate the sentence on the tenant having
an active human handler, or soften it to something Booka can stand behind. **This is a product
copy decision — get it agreed before changing the string, do not pick one silently.**

---

## Phase 2 — Tell the owner (§2) — ✅ DONE 2026-08-30

### Task 2.1 — Migration 144: low-balance alert marker

**Files:** `db/migrations/144_low_balance_alerts.sql` + `_rollback.sql`

```sql
ALTER TABLE public.ai_wallets
  ADD COLUMN IF NOT EXISTS low_balance_warned_on DATE;
```

Mirrors `message_handoff_warned_on` from 143. Do **not** reuse that column: exhaustion and
low-balance are different facts, and sharing one marker makes either alert suppress the other.

Validate forward → idempotent rerun → rollback → re-apply in a container. Paste the transcript.

### Task 2.2 — Low-balance warning on the reserve path

**Files:** `src/lib/billing/messageWallet.ts`, `src/lib/billing/walletAlerts.ts` (new), tests

`ai_wallets.low_balance_threshold_credits` has existed since migration 077 (`DEFAULT 25`) and
nothing on the message path reads it. This is the alert that actually helps — it fires while the
tenant can still act, rather than after the bot has gone quiet.

- After a **successful** reservation, compare the returned balance against the threshold.
- On a downward crossing, and if `low_balance_warned_on <> today`, emit the warning and stamp the
  date. A top-up naturally re-arms it, because the balance rises back above the threshold.
- Best-effort and non-blocking: **never** let an alert failure affect the send. Wrap it so a throw
  cannot escape, and check the returned supabase `error` rather than relying on try/catch —
  supabase-js resolves with an error instead of throwing, a mistake already made twice on this
  feature.

### Task 2.3 — Owner-facing delivery

**Files:** `src/lib/billing/walletAlerts.ts`, `src/lib/billing/messageHandoff.ts`, tests

One helper used by both the low-balance warning and the exhaustion alert:

- **Email** via `src/lib/integrations/email-service.ts`, to the tenant **owner** — resolve through
  `tenant_users` with `role = 'owner'`, not every member. Staff cannot top up.
- **WhatsApp to the owner** on exhaustion only. **It MUST use
  `getTenantWhatsAppProviderClientUnmetered`.** A metered send would reserve credit against the
  wallet that is empty, be refused, and trigger a handoff — the alert would fail exactly when it
  is needed, and would recurse. This is the single most important line in this phase.
- Keep the existing in-app `notifications` row and the ops Telegram line unchanged.

**Tests:** owner email resolution ignores non-owner members; the WhatsApp path uses the unmetered
client (assert it explicitly — the recursion guard must be pinned on purpose, not by mock shape);
a failing channel does not fail the others; the per-tenant-per-day cap holds across many
conversations.

### Task 2.4 — Severity on `notifications` — ✅ DECIDED: no column

**Files:** decision, then possibly `db/migrations/145_*`

**Decision: do not add one.** Only three call sites read `notifications` and none sort by
severity, so a column would be a schema change with no consumer. The discriminator already exists
as `meta->>'kind'` (`wallet_low_balance` / `wallet_handoff`), which a future dashboard can filter
or sort on without a migration. Revisit if a UI actually needs to rank them.

---

## Phase 3 — Auto-recharge (§1)

**Do not start Task 3.2 until Task 3.1 is reported and reviewed.**

### Task 3.1 — Verify Paystack's live API (no code)

Fetch current Paystack documentation and report, before anything is written:

1. Exact endpoint, request and response shape for charging a stored authorization.
2. Whether `reusable` authorizations are available on this account for **NGN cards**.
3. Paystack's own idempotency mechanism, if any, so ours composes rather than duplicates.
4. The decline taxonomy — which codes are retryable, which terminal.

This gate exists because the standing rule is to verify a package's real API before writing
against it, and because this moves real money. Report findings; then proceed.

### Task 3.2 — Migration 146: `tenant_payment_authorizations`

Columns per spec §1. RLS enabled, service-role policy, one active row per tenant (partial unique
index on `WHERE revoked_at IS NULL`). Never hard-delete a consent record.

**Follow migration 141/142's pattern: `REVOKE ALL … FROM PUBLIC, anon, authenticated` before
`GRANT … TO service_role` on any function, and pin `SET search_path = public, pg_temp`.** Postgres
grants EXECUTE to PUBLIC by default and `CREATE OR REPLACE` silently resets the search_path pin —
both were live defects on the metering branch.

### Task 3.3 — Consent capture

Checkout flow the tenant completes themselves, showing trigger amount, recharge amount and how to
cancel. Persist `data.authorization.authorization_code` from the `charge.success` webhook
(`src/app/api/payments/paystack/route.ts:49`) **only when** `reusable === true` **and** the
transaction carries the auto-recharge consent marker in its metadata.

**Do not opportunistically harvest tokens from ordinary customer payments** — those payers did not
consent, and the payer is frequently not the tenant.

Enabling `auto_recharge_enabled` without an active consent row must be impossible: enforce it in
the write path, not only in the UI.

### Task 3.4 — Replace the stub

`attemptAutoRecharge()` per spec §1, with every guardrail in §1.1: idempotency key, 1/hour and
3/day caps, tenant-set daily currency cap, fail-open-to-grace, and auto-disable after three
consecutive declines.

Credit **must** land via `topup_ai_wallet` so it appears in `ai_wallet_ledger` like every other
movement. Never write `balance_credits` directly.

**Tests:** each guardrail has a test that fails without it; a decline falls through to grace and
does not retry; a double-trigger charges once; three declines disable the feature.

### Task 3.5 — Docs

Update the operations guide: remove "do not enable `auto_recharge_enabled` for any tenant", and
document the consent flow, the guardrails, and how to revoke an authorization.

---

## Definition of done

- Full suite green; typecheck shows only the known `src/showcase/**` `TS6305` noise.
- Every migration validated forward → rerun → rollback → re-apply in a container, transcript pasted.
- Zero new lint errors in touched files.
- Operations guide updated in the same commit as the behaviour it documents.
