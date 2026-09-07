import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve(__dirname, '../../db/migrations/138_harden_retail_sale_functions.sql');

function migrationSql() {
  return readFileSync(migrationPath, 'utf8').replace(/\s+/g, ' ').toLowerCase();
}

describe('138 retail sale function security contract', () => {
  it('removes public execution and fixes the search path for privileged retail mutations', () => {
    expect(existsSync(migrationPath)).toBe(true);

    const sql = migrationSql();
    for (const signature of [
      'public.record_retail_sale_tx(uuid, uuid, jsonb, uuid, text, uuid, text, text, text, jsonb)',
      'public.refund_retail_sale_tx(uuid, uuid, uuid, text, text)',
    ]) {
      expect(sql).toContain(`alter function ${signature} set search_path = pg_catalog, public`);
      expect(sql).toContain(`revoke all on function ${signature} from public, anon, authenticated`);
      expect(sql).toContain(`grant execute on function ${signature} to service_role`);
    }
  });
});
