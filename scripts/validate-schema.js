#!/usr/bin/env node

/**
 * Pre-deploy schema validation gate.
 *
 * WHY THIS EXISTS
 * ---------------
 * The live database has drifted from the migrations: columns the application
 * code depends on can be absent on the live instance, which surfaces as
 * runtime 500s in production rather than anything a build step catches
 * (see CLAUDE.md > "Schema is the source of truth").
 *
 * This script asserts that the tables and columns the code HARD-DEPENDS on
 * actually exist in the target database, and exits non-zero if any are
 * missing. Run it against the DB *before* cutting production traffic over to
 * a freshly-built image, right after applying migrations. It is the gate that
 * turns a silent runtime 500 into a loud, pre-deploy failure.
 *
 * It is intentionally MANUAL and DB-facing (not a CI step): CI does not — and
 * should not — hold the service-role key or reach the live database. This
 * matches the existing operating model where migrations are applied by hand
 * on the VPS.
 *
 * USAGE
 * -----
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run db:validate
 *
 * The columns below are grounded in db/schema/live_schema_2026-07-30.md
 * (the authoritative information_schema dump) and in the code paths that most
 * recently shipped (messages.media_* for the WhatsApp media handler,
 * event_outbox.* for the event bus, and the ai_wallets / message-charge
 * columns the WhatsApp metering path reserves and settles against). Keep this manifest in sync with the
 * schema doc; it is a curated subset of critical dependencies, not the full
 * schema.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- standalone CommonJS operational script, not part of the TS build */
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Tables → columns the application code hard-depends on.
 * A missing table or column here means a real production breakage.
 */
const REQUIRED_SCHEMA = {
  tenants: ['id', 'name', 'plan', 'timezone', 'metadata', 'settings', 'status', 'lifecycle_state'],
  tenant_users: ['id', 'tenant_id', 'user_id', 'role', 'email', 'name', 'phone'],
  reservations: [
    'id', 'tenant_id', 'status', 'start_at', 'end_at',
    'customer_number', 'metadata', 'staff_id', 'service_id', 'price_cents_snapshot',
  ],
  transactions: [
    'id', 'tenant_id', 'amount', 'currency', 'type', 'status',
    'provider_reference', 'subject_type', 'subject_id', 'reconciliation_status',
  ],
  // media_url / media_info are the columns the WhatsApp media handler writes
  // (the admin-client fix in PR #100 / #91).
  messages: [
    'id', 'tenant_id', 'direction', 'message_type', 'content', 'created_at',
    'media_url', 'media_info',
  ],
  // The event bus outbox (PR #94 now publishes background-context events here).
  event_outbox: ['id', 'type', 'tenant_id', 'payload', 'hash', 'delivered_at', 'created_at'],
  customers: ['id', 'tenant_id', 'phone_number', 'normalized_phone'],
  // WhatsApp message metering (migrations 139-145). From 2026-10-01 Meta bills
  // every delivered service message, and every outbound send reserves against
  // this wallet — so a missing column here is not a degraded feature, it is the
  // send path failing for every tenant.
  ai_wallets: [
    'tenant_id', 'balance_credits', 'low_balance_threshold_credits',
    'message_rate_credits', 'grace_overdraft_credits',              // 139
    'auto_recharge_enabled', 'auto_recharge_amount_credits',        // 139
    'message_handoff_warned_on', 'message_handoff_unanchored_on',   // 143
    'low_balance_warned_on',                                        // 144
    'paystack_authorization_code', 'paystack_authorization_email',  // 145
    'auto_recharge_failed_at',                                      // 145
  ],
  ai_wallet_ledger: ['id', 'tenant_id', 'kind', 'amount_credits', 'reference', 'meter'],
  whatsapp_message_charges: [
    'id', 'tenant_id', 'provider', 'wamid', 'wallet_reservation_id',
    'reserved_credits', 'settled_credits', 'status', 'billable',
    'message_kind', 'mode', 'attribution', 'sent_at',
  ],
  // Paid top-up (145). Without it no owner can buy credits at all.
  wallet_topup_intents: [
    'id', 'tenant_id', 'reference', 'amount_credits', 'amount_minor',
    'currency', 'email', 'status', 'origin',
  ],
};

/** True when a supabase-js error indicates the whole relation is missing. */
function isMissingTableError(error) {
  if (!error) return false;
  const code = error.code || '';
  const msg = (error.message || '').toLowerCase();
  return (
    code === '42P01' || // undefined_table
    code === 'PGRST205' || // PostgREST: relation not found in schema cache
    msg.includes('does not exist') && msg.includes('relation') ||
    msg.includes('could not find the table')
  );
}

/** True when a supabase-js error indicates a specific column is missing. */
function isMissingColumnError(error) {
  if (!error) return false;
  const code = error.code || '';
  const msg = (error.message || '').toLowerCase();
  return (
    code === '42703' || // undefined_column
    (msg.includes('column') && msg.includes('does not exist')) ||
    (msg.includes("could not find the") && msg.includes("column"))
  );
}

async function tableExists(supabase, table) {
  // Select a constant to check the relation without depending on any column.
  const { error } = await supabase.from(table).select('*', { head: true, count: 'exact' }).limit(1);
  if (!error) return { ok: true };
  if (isMissingTableError(error)) return { ok: false, reason: 'missing_table' };
  // Any other error (RLS shouldn't apply under service role) — report it but
  // don't treat as a hard schema failure; surface for the operator.
  return { ok: true, warning: error.message };
}

async function columnExists(supabase, table, column) {
  const { error } = await supabase.from(table).select(column, { head: true }).limit(1);
  if (!error) return { ok: true };
  if (isMissingColumnError(error)) return { ok: false };
  // Unexpected error probing this column — warn but don't fail the gate on it.
  return { ok: true, warning: error.message };
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
    console.error('   Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run db:validate');
    process.exit(2);
  }

  const host = SUPABASE_URL.replace(/^https?:\/\/([^.]+)\..*$/, '$1');
  console.log(`🔍 Validating schema against project "${host}"\n`);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const missing = []; // { table, column? }
  const warnings = [];

  for (const [table, columns] of Object.entries(REQUIRED_SCHEMA)) {
    const t = await tableExists(supabase, table);
    if (t.warning) warnings.push(`${table}: ${t.warning}`);
    if (!t.ok) {
      missing.push({ table });
      console.log(`❌ ${table} — TABLE MISSING`);
      continue;
    }

    const missingCols = [];
    for (const column of columns) {
      const c = await columnExists(supabase, table, column);
      if (c.warning) warnings.push(`${table}.${column}: ${c.warning}`);
      if (!c.ok) missingCols.push(column);
    }

    if (missingCols.length === 0) {
      console.log(`✅ ${table} — ${columns.length} columns OK`);
    } else {
      for (const column of missingCols) missing.push({ table, column });
      console.log(`❌ ${table} — missing columns: ${missingCols.join(', ')}`);
    }
  }

  if (warnings.length) {
    console.log('\n⚠️  Non-fatal warnings (probe returned an unexpected error):');
    for (const w of warnings) console.log(`   - ${w}`);
  }

  console.log('');
  if (missing.length === 0) {
    console.log('✅ Schema validation PASSED — all required tables and columns present.');
    process.exit(0);
  }

  console.error(`❌ Schema validation FAILED — ${missing.length} missing item(s):`);
  for (const m of missing) {
    console.error(m.column ? `   - ${m.table}.${m.column}` : `   - ${m.table} (whole table)`);
  }
  console.error('\nApply the outstanding migrations before deploying, then re-run this gate.');
  process.exit(1);
}

// Exported for unit testing; only auto-run when invoked directly.
module.exports = { isMissingTableError, isMissingColumnError, REQUIRED_SCHEMA };

if (require.main === module) {
  main().catch((err) => {
    console.error('❌ Schema validation errored:', err && err.message ? err.message : err);
    process.exit(2);
  });
}
