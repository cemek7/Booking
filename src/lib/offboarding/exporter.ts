import type { SupabaseClient } from '@supabase/supabase-js';
import JSZip from 'jszip';
import { GRACE_DAYS } from './types';

const EXPORT_TABLES = [
  'reservations', 'customers', 'services', 'staff', 'transactions', 'messages', 'chats', 'tenants',
] as const;

function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}

export async function generateTenantExport(admin: SupabaseClient, tenantId: string): Promise<{ url: string }> {
  const zip = new JSZip();
  for (const table of EXPORT_TABLES) {
    const col = table === 'tenants' ? 'id' : 'tenant_id';
    const { data } = await admin.from(table).select('*').eq(col, tenantId);
    const rows = (data ?? []) as Record<string, unknown>[];
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
