import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve(__dirname, '../../db/migrations/141_overdraft_reservation.sql');
const rollbackPath = resolve(__dirname, '../../db/migrations/141_overdraft_reservation_rollback.sql');
const topupPath = resolve(__dirname, '../../db/migrations/142_fix_topup_ai_wallet_ambiguity.sql');
const topupRollbackPath = resolve(
  __dirname,
  '../../db/migrations/142_fix_topup_ai_wallet_ambiguity_rollback.sql',
);

function normalise(path: string) {
  return readFileSync(path, 'utf8').replace(/\s+/g, ' ').toLowerCase();
}

function migrationSql() {
  return readFileSync(migrationPath, 'utf8').replace(/\s+/g, ' ').toLowerCase();
}

function rollbackSql() {
  return readFileSync(rollbackPath, 'utf8').replace(/\s+/g, ' ').toLowerCase();
}

describe('141 WhatsApp metering wallet function security contract', () => {
  it('keeps recreated wallet mutation RPCs executable only by service_role', () => {
    expect(existsSync(migrationPath)).toBe(true);

    const sql = migrationSql();
    for (const signature of [
      'public.reserve_ai_wallet_spend(uuid, numeric, text, text, text, text, jsonb, numeric, text)',
      'public.settle_ai_wallet_spend(uuid, uuid, numeric, numeric, bigint, text, text, text, jsonb, text)',
    ]) {
      expect(sql).toContain(`revoke all on function ${signature} from public, anon, authenticated`);
      expect(sql).toContain(`grant execute on function ${signature} to service_role`);
    }
  });

  it('keeps the same execution boundary if the migration is rolled back', () => {
    expect(existsSync(rollbackPath)).toBe(true);

    const sql = rollbackSql();
    for (const signature of [
      'public.reserve_ai_wallet_spend(uuid, numeric, text, text, text, text, jsonb)',
      'public.settle_ai_wallet_spend(uuid, uuid, numeric, numeric, bigint, text, text, text, jsonb)',
    ]) {
      expect(sql).toContain(`revoke all on function ${signature} from public, anon, authenticated`);
      expect(sql).toContain(`grant execute on function ${signature} to service_role`);
    }
  });
});

// 142 recreates topup_ai_wallet, which CREATES wallet credit. It is the more
// dangerous of the two migrations to leave open: reserve/settle only move
// credit that already exists, whereas topup mints it. It was survivable before
// 142 only because the function was broken and always raised on an ambiguous
// column reference — fixing it without revoking would have turned a dead RPC
// into an anonymously callable money printer.
describe('142 topup/ensure wallet function security contract', () => {
  const signatures = [
    'public.topup_ai_wallet(uuid, numeric, text, text, jsonb)',
    'public.ensure_ai_wallet(uuid, text)',
  ];

  it('keeps credit-creating RPCs executable only by service_role', () => {
    expect(existsSync(topupPath)).toBe(true);
    const sql = normalise(topupPath);
    for (const signature of signatures) {
      expect(sql).toContain(`revoke all on function ${signature} from public, anon, authenticated`);
      expect(sql).toContain(`grant execute on function ${signature} to service_role`);
    }
  });

  it('keeps the same execution boundary if the migration is rolled back', () => {
    expect(existsSync(topupRollbackPath)).toBe(true);
    const sql = normalise(topupRollbackPath);
    for (const signature of signatures) {
      expect(sql).toContain(`revoke all on function ${signature} from public, anon, authenticated`);
      expect(sql).toContain(`grant execute on function ${signature} to service_role`);
    }
  });
});
