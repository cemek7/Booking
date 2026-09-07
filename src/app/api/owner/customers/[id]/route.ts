export const dynamic = 'force-dynamic';

import { createHttpHandler, getRouteParam, type RouteContext } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { BOOKA_PERMISSIONS } from '@/types/permissions';
import { recomputeProfile } from '@/lib/customers/profile';
import { detectDuplicates } from '@/lib/customers/merge';

async function loadCustomerProfile(ctx: RouteContext, customerId: string) {
  const tenantId = ctx.user!.tenantId!;
  const admin = createSupabaseAdminClient();

  await recomputeProfile(admin, tenantId, customerId);
  await detectDuplicates(admin, tenantId);

  const { data: customer, error: customerError } = await admin
    .from('customers')
    .select('id, name, customer_name, email, phone, phone_number, normalized_phone, tags, notes, merged_into, created_at')
    .eq('tenant_id', tenantId)
    .eq('id', customerId)
    .maybeSingle();

  if (customerError) throw ApiErrorFactory.databaseError(customerError);
  if (!customer) throw ApiErrorFactory.notFound('Customer');

  const { data: summary, error: summaryError } = await admin
    .from('customer_profile_summary')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('customer_id', customerId)
    .maybeSingle();

  if (summaryError) throw ApiErrorFactory.databaseError(summaryError);

  const { data: reservations, error: reservationError } = await admin
    .from('reservations')
    .select('id, start_at, status, price_cents_snapshot, service_id')
    .eq('tenant_id', tenantId)
    .eq('customer_id', customerId)
    .order('start_at', { ascending: false })
    .limit(10);

  if (reservationError) throw ApiErrorFactory.databaseError(reservationError);

  const { data: orders, error: ordersError } = await admin
    .from('retail_orders')
    .select('id, status, payment_status, total_cents, amount_paid_cents, updated_at')
    .eq('tenant_id', tenantId)
    .eq('customer_id', customerId)
    .order('updated_at', { ascending: false })
    .limit(10);

  if (ordersError) throw ApiErrorFactory.databaseError(ordersError);

  const { data: mergeCandidates, error: mergeError } = await admin
    .from('customer_merge_candidates')
    .select('id, customer_a, customer_b, score, status, metadata, created_at')
    .eq('tenant_id', tenantId)
    .or(`customer_a.eq.${customerId},customer_b.eq.${customerId}`)
    .order('score', { ascending: false });

  if (mergeError) throw ApiErrorFactory.databaseError(mergeError);

  const consents: Record<string, boolean> = {};
  const recipientPhone = customer.normalized_phone ?? customer.phone ?? customer.phone_number ?? null;
  const recipientEmail = customer.email ?? null;
  if (recipientPhone || recipientEmail) {
    const recipients = [recipientPhone, recipientEmail].filter((value): value is string => typeof value === 'string' && value.length > 0);
    if (recipients.length > 0) {
      const { data: consentRows } = await admin
        .from('messaging_consents')
        .select('recipient, channel')
        .eq('tenant_id', tenantId)
        .in('recipient', recipients);
      for (const row of consentRows ?? []) {
        consents[String((row as { channel?: string }).channel ?? 'unknown')] = true;
      }
    }
  }

  const canViewNotes = Boolean(ctx.user?.permissions?.includes(BOOKA_PERMISSIONS.VIEW_CUSTOMER_NOTES) || ctx.user?.role === 'owner' || ctx.user?.role === 'superadmin');

  return {
    customer: {
      ...customer,
      notes: canViewNotes ? customer.notes ?? null : null,
    },
    summary: summary ?? null,
    reservations: reservations ?? [],
    retailOrders: orders ?? [],
    mergeCandidates: mergeCandidates ?? [],
    consents,
    permissions: {
      canViewNotes,
      canMergeCustomers: Boolean(ctx.user?.permissions?.includes(BOOKA_PERMISSIONS.MERGE_CUSTOMERS) || ctx.user?.role === 'owner' || ctx.user?.role === 'superadmin'),
    },
  };
}

export const GET = createHttpHandler(
  async (ctx) => {
    const customerId = getRouteParam(ctx.params, 'id');
    return loadCustomerProfile(ctx, customerId);
  },
  'GET',
  { auth: true, roles: ['owner', 'manager'], permissions: [BOOKA_PERMISSIONS.VIEW_ANALYTICS] },
);
