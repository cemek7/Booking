import type { SupabaseClient } from '@supabase/supabase-js';
import { CUSTOMER_PII_TABLES, type PiiTable } from './registry';

export interface DsarExport {
  customer: Record<string, unknown> | null;
  tables: Record<string, unknown[]>;
}

interface QueryContext {
  tenantId: string;
  customerId: string;
  phone: string | null;
  reservationIds: string[];
}

/**
 * Read-only export of everything we hold about one end-customer, assembled from
 * the DSAR registry. Tenant-scoped. Never mutates.
 */
export async function exportCustomerData(
  admin: SupabaseClient,
  params: { tenantId: string; customerId: string },
): Promise<DsarExport> {
  const { tenantId, customerId } = params;

  const { data: customer } = await admin
    .from('customers')
    .select('*')
    .eq('id', customerId)
    .eq('tenant_id', tenantId)
    .single();

  const phone = (customer as { phone?: string } | null)?.phone ?? null;

  const { data: reservationRows } = await admin
    .from('reservations')
    .select('id')
    .eq('customer_id', customerId)
    .eq('tenant_id', tenantId);
  const reservationIds = ((reservationRows ?? []) as Array<{ id: string }>).map((r) => r.id);

  const ctx: QueryContext = { tenantId, customerId, phone, reservationIds };
  const tables: Record<string, unknown[]> = {};
  for (const entry of CUSTOMER_PII_TABLES) {
    tables[entry.table] = await queryRows(admin, entry, ctx);
  }

  return { customer: (customer as Record<string, unknown> | null) ?? null, tables };
}

async function queryRows(
  admin: SupabaseClient,
  entry: PiiTable,
  ctx: QueryContext,
): Promise<unknown[]> {
  if (entry.link.kind === 'phone' && !ctx.phone) return [];
  if (entry.link.kind === 'reservationId' && ctx.reservationIds.length === 0) return [];

  let q = admin.from(entry.table).select('*').eq('tenant_id', ctx.tenantId);

  if (entry.link.kind === 'customerId') {
    q = q.eq('customer_id', ctx.customerId);
  } else if (entry.link.kind === 'phone') {
    q = q.or(entry.link.columns.map((c) => `${c}.eq.${ctx.phone}`).join(','));
  } else {
    q = q.in('reservation_id', ctx.reservationIds);
  }

  const { data } = await q;
  return (data as unknown[]) ?? [];
}
