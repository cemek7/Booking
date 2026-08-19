# Migration Collision Resolution Runbook

**Audience:** a human operator with prod DB access. **Do NOT automate any step here.**
**Companion:** run `db/audits/core_path_audit.sql` first; this runbook interprets its output.

## The hazard

Migrations are applied in filename sort order. Four migration *numbers* have two distinct
**forward** migrations each, so the apply order between the two members of a pair is ambiguous on
a fresh apply-from-zero, and on an existing prod DB both may already be applied:

| Number | File A | File B |
|---|---|---|
| 065 | `065_chats_unique_constraint.sql` | `065_messages_read_columns.sql` |
| 077 | `077_ai_wallets.sql` | `077_customer_no_show_score.sql` |
| 079 | `079_finance_ledgers.sql` | `079_whatsapp_message_queue_channel.sql` |
| 097 | `097_ai_front_desk_stage_d_training_views.sql` | `097_wallet_cost_caps.sql` |

(`078_*` and `082_*` also share a number but the extra files are `_rollback` scripts, which are
not part of the forward sequence — ignore them here.)

Each pair touches **independent** objects (different tables/columns), so applying them in either
order is functionally safe **as long as both eventually run**. The real risk is a member being
*skipped* — and because several use `ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS`, a
skip is silent.

The launch-critical member is **`077_customer_no_show_score.sql`** — it powers no-show recovery.
For **097**, both members are launch-relevant and independent: `097_wallet_cost_caps.sql` (AI spend
caps on `ai_wallets`) and `097_ai_front_desk_stage_d_training_views.sql` (AI-front-desk training
views). Verify **both** applied — neither replaces the other.

## Procedure

### Step 1 — audit (read-only)
```bash
psql "$DATABASE_URL" -f db/audits/core_path_audit.sql
```

### Step 2 — interpret
- **Section 1 returns 2 rows** → `077_customer_no_show_score.sql` is applied. No action.
- **Section 1 returns 0/1 rows** → no-show columns missing. Apply the manual fallback below.
- **Section 3 `webhook_events` is null or has no unique constraint** → webhook replay protection is
  degraded. This is a payment-correctness issue — escalate before taking real deposits.
- **Section 5** confirms the other collision-pair objects exist; if any are missing, hand-apply the
  additive statements from the corresponding migration file (they are all additive/idempotent).

### Step 3 — manual fallback for no-show columns (only if Section 1 is incomplete)
Copied verbatim from `077_customer_no_show_score.sql` (additive, safe to re-run):
```sql
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS no_show_count INT NOT NULL DEFAULT 0;
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS risk_score TEXT NOT NULL DEFAULT 'low';
```
Re-run Section 1 of the audit to confirm 2 rows.

## What NOT to do

- **Do NOT rename or renumber a migration that is already recorded as applied** in the target DB.
  Renaming an applied migration makes the tracker re-run or skip it unpredictably → corruption.
- **Do NOT** "fix" the collision by editing migration history on a DB that has already applied it.
- Renumbering for cleanliness is only acceptable on a brand-new environment that has applied
  **neither** member of a pair — and even then, prefer leaving history immutable.
