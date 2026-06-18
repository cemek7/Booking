-- core_path_audit.sql — READ ONLY. Run against the TARGET (prod) DB to confirm the
-- operations-loop columns / tables actually exist. The IF NOT EXISTS migrations may have
-- silently skipped on a pre-existing table, so do not assume — verify.
--
-- Usage: psql "$DATABASE_URL" -f db/audits/core_path_audit.sql
-- Nothing here writes. Safe to run on production.

\echo '== 1. No-show scoring columns (migration 077_customer_no_show_score.sql) =='
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'customers'
  AND column_name IN ('no_show_count', 'risk_score')
ORDER BY column_name;
-- EXPECT: 2 rows — no_show_count (integer, default 0), risk_score (text, default 'low')

\echo '== 2. Transactions columns used by the payment webhook =='
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'transactions'
  AND column_name IN ('provider_reference', 'reconciliation_status', 'status', 'tenant_id', 'type', 'raw')
ORDER BY column_name;
-- EXPECT: 6 rows. provider_reference is the webhook's only trusted lookup key.

\echo '== 3. Webhook idempotency table + unique constraint (replay protection) =='
SELECT to_regclass('public.webhook_events') AS webhook_events_table;
-- EXPECT: public.webhook_events (NOT null). The webhook relies on a UNIQUE violation (23505)
-- on (provider, external_id) to detect replays — if this table or constraint is missing,
-- replay protection silently degrades to "process every delivery".
SELECT conname, contype
FROM pg_constraint
WHERE conrelid = 'public.webhook_events'::regclass AND contype = 'u';
-- EXPECT: at least 1 unique constraint.

\echo '== 4. Reservations columns written by the auto-cancel sweep =='
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'reservations'
  AND column_name IN ('status', 'cancellation_reason', 'cancelled_at', 'start_at', 'tenant_id')
ORDER BY column_name;
-- EXPECT: 5 rows. The sweep transitions status -> 'cancelled' and stamps cancellation_reason + cancelled_at.

\echo '== 5. Collision-pair object presence (065 / 077 / 079) =='
-- 065: chats unique constraint vs messages read columns
SELECT to_regclass('public.chats') AS chats, to_regclass('public.messages') AS messages;
SELECT column_name FROM information_schema.columns
WHERE table_name = 'messages' AND column_name IN ('read_at', 'read_by');
-- 077: ai_wallets vs customer no-show (covered in section 1 + below)
SELECT to_regclass('public.ai_wallets') AS ai_wallets;
-- 079: finance ledgers vs whatsapp_message_queue.channel
SELECT to_regclass('public.tenant_cost_ledger') AS tenant_cost_ledger,
       to_regclass('public.tenant_revenue_ledger') AS tenant_revenue_ledger;
SELECT column_name FROM information_schema.columns
WHERE table_name = 'whatsapp_message_queue' AND column_name = 'channel';

\echo '== Audit complete. Cross-check results against docs/runbooks/migration-collision-resolution.md =='
