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

  describe.each([...METERED_TABLES, ...RELATIONSHIP_VIEWS])('%s', (table) => {
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
});
