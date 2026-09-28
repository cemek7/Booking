import { describe, it, expect } from '@jest/globals';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * The deploy gate only protects what its manifest lists, and the manifest is
 * hand-maintained. A typo in it fails open — the gate reports a healthy schema
 * for a column it never actually checked.
 *
 * This pins the metering entries against the migrations that create them.
 * CLAUDE.md records that the live DB has drifted from the migrations before and
 * that missing columns are a recurring source of production 500s, which is the
 * whole reason the gate exists.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { REQUIRED_SCHEMA } = require('../../../scripts/validate-schema.js') as {
  REQUIRED_SCHEMA: Record<string, string[]>;
};

const MIGRATIONS_DIR = join(process.cwd(), 'db', 'migrations');

function migrationsMentioning(table: string): string {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql') && !f.includes('rollback'))
    .map((f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf8'))
    .filter((sql) => sql.includes(table))
    .join('\n');
}

const METERED_TABLES = [
  'ai_wallets',
  'ai_wallet_ledger',
  'whatsapp_message_charges',
  'wallet_topup_intents',
  'message_rate_card',
  'platform_fx_rates',
];

/**
 * Relationship views (094). These fail SAFE at runtime — a missing view yields
 * empty grounding, not an error — so nothing surfaces if 094 was never applied
 * except an assistant that has quietly forgotten every customer. The gate is
 * the only thing that turns that into a visible failure.
 */
const RELATIONSHIP_VIEWS = [
  'customer_service_history_view',
  'staff_customer_history_view',
  'followup_candidates_view',
  'tenant_revenue_view',
];

const BOOKING_SAFETY_TABLES = ['business_hours', 'slot_locks'];

const CONVERSATION_CONTINUITY_TABLES = [
  'shared_channel_route_sessions',
  'customer_channel_identities',
  'conversation_threads',
  'customer_memory_facts',
  'conversation_effects',
  'whatsapp_conversations',
  'whatsapp_message_queue',
];

describe('db:validate manifest', () => {
  it('covers every table the metering path writes to', () => {
    METERED_TABLES.forEach((table) => {
      expect(Object.keys(REQUIRED_SCHEMA)).toContain(table);
    });
  });

  it('covers the relationship views the AI grounding service reads', () => {
    RELATIONSHIP_VIEWS.forEach((view) => {
      expect(Object.keys(REQUIRED_SCHEMA)).toContain(view);
    });
  });

  it('covers the schedule fallback and WhatsApp hold tables', () => {
    BOOKING_SAFETY_TABLES.forEach((table) => {
      expect(Object.keys(REQUIRED_SCHEMA)).toContain(table);
    });
    expect(REQUIRED_SCHEMA.business_hours).toEqual(
      expect.arrayContaining(['tenant_id', 'day_of_week', 'start_time', 'end_time']),
    );
    expect(REQUIRED_SCHEMA.slot_locks).toEqual(
      expect.arrayContaining(['tenant_id', 'tenant_staff_id', 'date', 'start_time', 'end_time', 'expires_at']),
    );
  });

  it('pins the database concurrency boundary to migration 152', () => {
    const sql = readFileSync(
      join(MIGRATIONS_DIR, '152_booking_hours_reservation_safety.sql'),
      'utf8',
    );
    expect(sql).toContain('reservations_no_active_overlap');
    expect(sql).toMatch(/EXCLUDE\s+USING\s+gist/i);
  });

  describe.each([...METERED_TABLES, ...RELATIONSHIP_VIEWS, ...BOOKING_SAFETY_TABLES])('%s', (table) => {
    it('lists only columns a migration actually creates', () => {
      const sql = migrationsMentioning(table);
      expect(sql).not.toBe('');

      const missing = REQUIRED_SCHEMA[table].filter(
        (column) => !new RegExp(`\\b${column}\\b`).test(sql),
      );

      // A name here that no migration creates means the gate would report the
      // column missing on a correctly-migrated database, and block the deploy
      // for no reason.
      expect(missing).toEqual([]);
    });
  });

  it('pins the columns the send path cannot run without', () => {
    // reserveOutboundMessage reads these on every outbound message; settlement
    // and the sweeper key on wamid and wallet_reservation_id.
    expect(REQUIRED_SCHEMA.ai_wallets).toEqual(
      expect.arrayContaining(['balance_credits', 'grace_overdraft_credits', 'auto_recharge_enabled']),
    );
    expect(REQUIRED_SCHEMA.whatsapp_message_charges).toEqual(
      expect.arrayContaining(['wamid', 'wallet_reservation_id', 'reserved_credits', 'status']),
    );
    // credit_wallet_topup claims on reference + status; without them no owner
    // can buy credits.
    expect(REQUIRED_SCHEMA.wallet_topup_intents).toEqual(
      expect.arrayContaining(['reference', 'status', 'amount_credits', 'amount_minor']),
    );
  });

  it('covers the tenant-safe conversation continuity boundary', () => {
    CONVERSATION_CONTINUITY_TABLES.forEach((table) => {
      expect(Object.keys(REQUIRED_SCHEMA)).toContain(table);
    });
    expect(REQUIRED_SCHEMA.shared_channel_route_sessions).toEqual(expect.arrayContaining([
      'tenant_id', 'channel', 'gateway_scope', 'external_id', 'source', 'expires_at',
    ]));
    expect(REQUIRED_SCHEMA.customer_channel_identities).toEqual(expect.arrayContaining([
      'tenant_id', 'customer_id', 'channel', 'external_id', 'verification_state',
    ]));
    expect(REQUIRED_SCHEMA.conversation_threads).toEqual(expect.arrayContaining([
      'tenant_id', 'customer_id', 'channel_identity_id', 'status', 'structured_state',
      'rolling_summary', 'state_version', 'human_handling_until',
    ]));
    expect(REQUIRED_SCHEMA.customer_memory_facts).toEqual(expect.arrayContaining([
      'tenant_id', 'customer_id', 'namespace', 'fact_key', 'fact_value', 'status',
      'source_type', 'source_message_id', 'source_record_id', 'consent_basis',
      'verified_at', 'expires_at', 'superseded_by',
    ]));
    expect(REQUIRED_SCHEMA.conversation_effects).toEqual(expect.arrayContaining([
      'tenant_id', 'thread_id', 'idempotency_key', 'effect_type', 'status',
    ]));
    expect(REQUIRED_SCHEMA.whatsapp_conversations).toEqual(expect.arrayContaining([
      'customer_id', 'active_thread_id', 'state_version',
    ]));
    expect(REQUIRED_SCHEMA.messages).toEqual(expect.arrayContaining([
      'conversation_thread_id', 'provider_message_id', 'delivery_status', 'idempotency_key',
    ]));
    expect(REQUIRED_SCHEMA.whatsapp_message_queue).toEqual(expect.arrayContaining([
      'conversation_id', 'conversation_thread_id', 'provider_timestamp',
      'lease_owner', 'lease_expires_at', 'batch_id',
    ]));
  });
});
