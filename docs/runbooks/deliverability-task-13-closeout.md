# Deliverability Task 13 Close-out

This runbook closes the remaining operator-owned steps from `docs/superpowers/plans/2026-06-23-deliverability-reputation.md`.

## What this runbook covers

- applying migration `091_deliverability_reputation.sql`
- verifying the three deliverability tables exist in the target database
- seeding shared-number Meta templates into `message_templates`
- running the plan's focused verification commands

## Preconditions

- `DATABASE_URL` points at the target Postgres/Supabase database
- approved Meta templates already exist in the Meta app for:
  - `rebooking_followup`
  - `rebooking_nudge`
  - `waitlist_slot`
- the template names in [scripts/sql/seed_deliverability_templates.sql](/home/ccemeka/Techclave/Booking/Booking/scripts/sql/seed_deliverability_templates.sql:1) have been edited to match the approved Meta names exactly

## 1. Apply the migration

```bash
psql "$DATABASE_URL" -f db/migrations/091_deliverability_reputation.sql
```

Re-run the same command once to confirm the `IF NOT EXISTS` migration is idempotent.

## 2. Verify the live schema

```bash
psql "$DATABASE_URL" -f scripts/sql/verify_deliverability_reputation.sql
```

Expected:
- `message_templates` exists
- `tenant_messaging_stats` exists
- `whatsapp_number_quality` exists

If your current schema still matches the snapshot from June 25, 2026 and these tables are missing, stop here and apply migration `091` first.

## 3. Seed shared-number templates

Edit the template names in [scripts/sql/seed_deliverability_templates.sql](/home/ccemeka/Techclave/Booking/Booking/scripts/sql/seed_deliverability_templates.sql:1), then run:

```bash
psql "$DATABASE_URL" -f scripts/sql/seed_deliverability_templates.sql
psql "$DATABASE_URL" -f scripts/sql/verify_deliverability_reputation.sql
```

Expected:
- one `tenant_id IS NULL` row for each message type
- `status = approved`
- `language = en_US`

## 4. Run the focused verification checkpoint

```bash
NODE_OPTIONS="--max-old-space-size=4096" npx jest \
  src/__tests__/lib/whatsapp/v2/deliverability/ \
  src/__tests__/lib/whatsapp/providers/meta-template-language.test.ts \
  src/__tests__/api/cron/nightly/

NODE_OPTIONS="--max-old-space-size=4096" npx tsc --noEmit
```

This is the plan-aligned checkpoint for deliverability. If unrelated legacy suites fail elsewhere in the repo, treat them separately from Task 13 closure.

## 5. Seed the shared number quality row if needed

The first Meta quality webhook should normally create/update `whatsapp_number_quality`. If you need a bootstrap row before the webhook lands, use:

```sql
INSERT INTO whatsapp_number_quality (phone_number_id, quality_rating, limit_per_24h, updated_at)
VALUES ('REPLACE_WITH_SHARED_PHONE_NUMBER_ID', 'UNKNOWN', 1000, now())
ON CONFLICT (phone_number_id)
DO UPDATE SET updated_at = now();
```

## Done criteria

Task 13 is closed when:
- migration `091` is applied in the target DB
- the three deliverability tables exist live
- approved templates are seeded into `message_templates`
- the focused Jest checkpoint passes
- `tsc --noEmit` passes without deliverability-specific regressions
