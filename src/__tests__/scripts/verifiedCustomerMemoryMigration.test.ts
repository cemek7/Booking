import fs from 'fs';
import path from 'path';

describe.each([
  'db/migrations/157_verified_customer_memory.sql',
  'db/releases/2026-09-29-verified-customer-memory.sql',
])('%s', (relativePath) => {
  const sql = fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

  it('validates source ownership and serializes corrections', () => {
    expect(sql).toMatch(/m\.tenant_id = p_tenant_id[\s\S]*ct\.customer_id = p_customer_id/i);
    expect(sql).toMatch(/tu\.tenant_id = p_tenant_id AND tu\.user_id = p_source_record_id/i);
    expect(sql).toMatch(/pg_advisory_xact_lock/i);
    expect(sql).toMatch(/status = 'superseded'/i);
    expect(sql).toMatch(/superseded_by = v_new_id/i);
  });

  it('locks down the function to service role', () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC, anon, authenticated/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION[\s\S]*TO service_role/i);
    expect(sql).toMatch(/SET search_path = public, pg_temp/i);
  });
});
