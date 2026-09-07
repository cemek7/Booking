import type { SupabaseClient } from '@supabase/supabase-js';

import { recomputeProfile } from './profile';

type ProfileEvent = {
  tenantId: string;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
};

const CUSTOMER_PROFILE_ACTIONS = new Set([
  'reservation.completed',
  'payment.recorded',
  'retail_sale.recorded',
  'retail_order.created',
  'retail_order.delivered',
  'order.refunded',
  'outstanding_balance.recorded',
]);

async function resolveCustomerIds(
  admin: SupabaseClient,
  event: ProfileEvent,
): Promise<string[]> {
  if (!CUSTOMER_PROFILE_ACTIONS.has(event.action) || !event.entityId) return [];

  if (event.entityType === 'reservation') {
    const { data } = await admin
      .from('reservations')
      .select('customer_id')
      .eq('tenant_id', event.tenantId)
      .eq('id', event.entityId)
      .maybeSingle<{ customer_id?: string | null }>();
    return typeof data?.customer_id === 'string' ? [data.customer_id] : [];
  }

  if (event.entityType === 'retail_order') {
    const { data } = await admin
      .from('retail_orders')
      .select('customer_id')
      .eq('tenant_id', event.tenantId)
      .eq('id', event.entityId)
      .maybeSingle<{ customer_id?: string | null }>();
    return typeof data?.customer_id === 'string' ? [data.customer_id] : [];
  }

  return [];
}

export async function processBusinessEventForCustomerProfile(
  admin: SupabaseClient,
  event: ProfileEvent,
): Promise<void> {
  const customerIds = await resolveCustomerIds(admin, event);
  for (const customerId of customerIds) {
    await recomputeProfile(admin, event.tenantId, customerId);
  }
}
