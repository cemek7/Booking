import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * redeem_wallet_promo adds credits without a payment, so its grant is the only
 * thing standing between a promo code and free value. Postgres grants EXECUTE
 * to PUBLIC on every new function, and CREATE OR REPLACE silently resets a
 * search_path pin — so both are asserted here rather than trusted to survive
 * the next edit of the migration.
 */
const migrationPath = resolve(__dirname, '../../db/migrations/146_wallet_promo_codes.sql');

function migrationSql() {
  return readFileSync(migrationPath, 'utf8').replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Statements only. The migration's comments discuss the ledgers it
 * deliberately avoids, so an assertion about what the SQL *does* has to read
 * past them.
 */
function migrationStatements() {
  return readFileSync(migrationPath, 'utf8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join(' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

describe('146 promotional credit security contract', () => {
  it('exists', () => {
    expect(existsSync(migrationPath)).toBe(true);
  });

  it('withholds execution from every role except service_role', () => {
    const sql = migrationSql();
    const signature = 'public.redeem_wallet_promo(uuid, text, uuid)';

    for (const role of ['public', 'anon', 'authenticated']) {
      expect(sql).toContain(`revoke all on function ${signature} from ${role}`);
    }
    expect(sql).toContain(`grant execute on function ${signature} to service_role`);
    expect(sql).toContain(`alter function ${signature} set search_path = public, pg_temp`);
  });

  it('keeps row-level security on both promo tables', () => {
    const sql = migrationSql();
    expect(sql).toContain('alter table public.wallet_promo_codes enable row level security');
    expect(sql).toContain('alter table public.wallet_promo_redemptions enable row level security');
  });

  it('stores a hash rather than the code, and keeps that hash unique', () => {
    const sql = migrationSql();
    expect(sql).toContain('code_hash text not null unique');
    expect(sql).not.toMatch(/\bcode text\b/);
  });

  it('refuses a non-positive grant and a per-tenant cap below one', () => {
    const sql = migrationSql();
    expect(sql).toContain('amount_credits numeric(20,6) not null check (amount_credits > 0)');
    expect(sql).toContain('max_redemptions_per_tenant integer not null default 1 check (max_redemptions_per_tenant > 0)');
  });

  it('locks the code row before checking caps, so concurrent redemptions serialize', () => {
    const sql = migrationSql();
    expect(sql).toContain('from public.wallet_promo_codes where code_hash = p_code_hash for update');
  });

  it('does not book promotional credit as revenue or as a paid top-up', () => {
    const sql = migrationStatements();
    expect(sql).not.toContain('tenant_revenue_ledger');
    expect(sql).not.toContain('lifetime_topups_credits');
  });
});
