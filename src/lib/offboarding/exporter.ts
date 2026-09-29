import type { SupabaseClient } from '@supabase/supabase-js';
import JSZip from 'jszip';
import { GRACE_DAYS } from './types';

// Real tenant-scoped tables (verified against live schema). 'staff' is not a
// table — staff/members live in tenant_users.
const EXPORT_TABLES: ReadonlyArray<{ table: string; columns: string }> = [
  { table: 'reservations', columns: '*' },
  { table: 'customers', columns: '*' },
  { table: 'services', columns: '*' },
  { table: 'tenant_users', columns: '*' },
  { table: 'transactions', columns: '*' },
  { table: 'messages', columns: '*' },
  { table: 'chats', columns: '*' },
  { table: 'reviews', columns: '*' },
  { table: 'faqs', columns: '*' },
  { table: 'leads', columns: '*' },
  { table: 'tenants', columns: '*' },
  { table: 'shared_channel_route_sessions', columns: '*' },
  { table: 'customer_channel_identities', columns: '*' },
  { table: 'conversation_threads', columns: '*' },
  { table: 'customer_memory_facts', columns: '*' },
  {
    table: 'conversation_effects',
    columns: 'id,tenant_id,thread_id,idempotency_key,effect_type,status,result_ref,created_at,updated_at',
  },
];

function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}

export async function generateTenantExport(admin: SupabaseClient, tenantId: string): Promise<{ url: string }> {
  const zip = new JSZip();
  for (const descriptor of EXPORT_TABLES) {
    const { table, columns } = descriptor;
    const col = table === 'tenants' ? 'id' : 'tenant_id';
    const { data } = await admin.from(table).select(columns).eq(col, tenantId);
    // Table/column descriptors are deliberately dynamic so one export loop can
    // cover both full rows and the redacted conversation-effects projection.
    // Supabase cannot infer that dynamic result shape at compile time.
    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    zip.file(`json/${table}.json`, JSON.stringify(rows, null, 2));
    zip.file(`csv/${table}.csv`, toCsv(rows));
  }
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  const path = `${tenantId}/export-${Date.now()}.zip`;
  const { error: upErr } = await admin.storage.from('tenant-exports')
    .upload(path, buffer, { contentType: 'application/zip', upsert: true });
  if (upErr) throw new Error(`export upload failed: ${upErr.message}`);

  const ttlSeconds = GRACE_DAYS() * 24 * 60 * 60;
  const { data, error } = await admin.storage.from('tenant-exports').createSignedUrl(path, ttlSeconds);
  if (error || !data) throw new Error(`signed url failed: ${error?.message}`);
  return { url: data.signedUrl };
}
