import type { SupabaseClient } from '@supabase/supabase-js';
import { CUSTOMER_PII_TABLES, type PiiLink, type PiiTable } from './registry';
import { buildAnonymizedPatch, ERASED } from './anonymize';

export interface EraseActionResult {
  table: string;
  op: 'anonymize' | 'delete' | 'skip';
}

export interface EraseReport {
  dryRun: boolean;
  actions: EraseActionResult[];
}

interface EraseContext {
  tenantId: string;
  customerId: string;
  phone: string | null;
  reservationIds: string[];
}

/**
 * Erase one end-customer per the DSAR registry: anonymize financial/booking rows
 * (kept for retention), hard-delete the rest, and anonymize the customer anchor
 * last. DESTRUCTIVE only when `dryRun: false` — defaults to a dry run that reports
 * the planned actions without mutating anything.
 */
export async function eraseCustomerData(
  admin: SupabaseClient,
  params: { tenantId: string; customerId: string; dryRun?: boolean },
): Promise<EraseReport> {
  const { tenantId, customerId, dryRun = true } = params;

  const { data: customer } = await admin
    .from('customers')
    .select('phone')
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

  const ctx: EraseContext = { tenantId, customerId, phone, reservationIds };
  const actions: EraseActionResult[] = [];

  for (const entry of CUSTOMER_PII_TABLES) {
    const resolvable =
      (entry.link.kind !== 'phone' || ctx.phone) &&
      (entry.link.kind !== 'reservationId' || ctx.reservationIds.length > 0);
    if (!resolvable) {
      actions.push({ table: entry.table, op: 'skip' });
      continue;
    }
    actions.push({ table: entry.table, op: entry.onErase });
    if (!dryRun) await runErase(admin, entry, ctx);
  }

  // Anchor row last: anonymize name + phone (keep the row; phone stays unique/not-null).
  actions.push({ table: 'customers', op: 'anonymize' });
  if (!dryRun) {
    await admin
      .from('customers')
      .update({ name: ERASED, phone: `erased-${customerId}` })
      .eq('id', customerId)
      .eq('tenant_id', tenantId);
  }

  return { dryRun, actions };
}

async function runErase(admin: SupabaseClient, entry: PiiTable, ctx: EraseContext): Promise<void> {
  if (entry.onErase === 'anonymize') {
    const patch = buildAnonymizedPatch(entry.piiColumns);
    if (Object.keys(patch).length === 0) return;
    await applyLink(admin.from(entry.table).update(patch), entry.link, ctx);
  } else {
    await applyLink(admin.from(entry.table).delete(), entry.link, ctx);
  }
}

function applyLink<T extends { eq: (c: string, v: unknown) => T; or: (e: string) => T; in: (c: string, v: unknown[]) => T }>(
  q: T,
  link: PiiLink,
  ctx: EraseContext,
): T {
  const scoped = q.eq('tenant_id', ctx.tenantId);
  if (link.kind === 'customerId') return scoped.eq('customer_id', ctx.customerId);
  if (link.kind === 'phone') return scoped.or(link.columns.map((c) => `${c}.eq.${ctx.phone}`).join(','));
  return scoped.in('reservation_id', ctx.reservationIds);
}
