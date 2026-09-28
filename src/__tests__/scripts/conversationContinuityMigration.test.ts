import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const migrationPath = join(process.cwd(), 'db/migrations/153_conversation_continuity.sql');

function readMigration(): string {
  return existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';
}

describe('conversation continuity migration', () => {
  it('defines tenant isolation, atomic ingestion, leased claims, and optimistic updates', () => {
    const sql = readMigration();

    for (const table of [
      'shared_channel_route_sessions',
      'customer_channel_identities',
      'conversation_threads',
      'customer_memory_facts',
      'conversation_effects',
    ]) {
      expect(sql).toMatch(new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`, 'i'));
    }

    expect(sql).toMatch(/UNIQUE\s*\(tenant_id,\s*channel,\s*external_id\)/i);
    expect(sql).toMatch(/UNIQUE\s*\(channel,\s*gateway_scope,\s*external_id\)/i);
    expect(sql).toMatch(/UNIQUE\s*\(tenant_id,\s*idempotency_key\)/i);
    expect(sql).toMatch(/source_message_id\s+uuid\s+REFERENCES\s+public\.messages\(id\)/i);
    expect(sql).toContain('claim_whatsapp_conversation_batch');
    expect(sql).toContain('ingest_conversation_message');
    expect(sql).toContain('update_conversation_thread_state');
    expect(sql).toContain('update_conversation_thread_summary');
    expect(sql).toMatch(/FOR UPDATE SKIP LOCKED/i);
    expect(sql).toContain('pg_try_advisory_xact_lock');
    expect(sql).toMatch(/SET search_path = public, pg_temp/g);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION[\s\S]+FROM PUBLIC, anon, authenticated/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION[\s\S]+TO service_role/i);
  });

  it('extends customer merging to every new customer-owned relation', () => {
    const sql = readMigration();
    const mergeStart = sql.indexOf('CREATE OR REPLACE FUNCTION public.merge_customers_tx');
    expect(mergeStart).toBeGreaterThan(-1);
    const mergeSql = sql.slice(mergeStart);

    expect(mergeSql).toContain('customer_channel_identities');
    expect(mergeSql).toContain('conversation_threads');
    expect(mergeSql).toContain('customer_memory_facts');
  });

  it('keeps the forward migration expand-only', () => {
    const sql = readMigration();
    expect(sql).not.toMatch(/DROP\s+(TABLE|COLUMN)\b/i);
  });
});
