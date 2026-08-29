import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve(__dirname, '../../db/migrations/141_overdraft_reservation.sql');
const rollbackPath = resolve(__dirname, '../../db/migrations/141_overdraft_reservation_rollback.sql');

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
