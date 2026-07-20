import type { SupabaseClient } from '@supabase/supabase-js';
import { BUSINESS_EVENT_ACTIONS, recordBusinessEvent } from '@/lib/audit/businessEvents';
import { logAiAction } from '@/lib/ai/aiActionLog';
import type { ActionHandler } from './registry';

type ActionContext = { actorId?: string | null; role?: string };

function getString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

async function staffSalesQueryExecute(admin: SupabaseClient, tenantId: string, params: Record<string, unknown>) {
  const staffId = getString(params.staff_id);
  let query = admin
    .from('tenant_revenue_view')
    .select('staff_id, staff_name, booking_count, completed_count, estimated_revenue')
    .eq('tenant_id', tenantId);

  if (staffId) query = query.eq('staff_id', staffId);

  const { data, error } = await query;
  if (error) return { success: false, error: error.message };

  const summary = new Map<string, { staff_id: string; staff_name: string; completed: number; bookings: number; revenue: number }>();
  for (const row of data ?? []) {
    const key = String(row.staff_id ?? '');
    if (!key) continue;
    const current = summary.get(key) ?? {
      staff_id: key,
      staff_name: String(row.staff_name ?? 'Unknown'),
      completed: 0,
      bookings: 0,
      revenue: 0,
    };
    current.completed += Number(row.completed_count ?? 0);
    current.bookings += Number(row.booking_count ?? 0);
    current.revenue += Number(row.estimated_revenue ?? 0);
    summary.set(key, current);
  }

  const items = [...summary.values()];
  const reply = items.length
    ? `Staff sales:\n${items.map((item) => `• ${item.staff_name}: ${item.completed} completed, ₦${Math.round(item.revenue).toLocaleString()}`).join('\n')}`
    : 'No staff sales data found.';

  return { success: true, reply, data: { items } };
}

async function staffDiscountQueryExecute(admin: SupabaseClient, tenantId: string, params: Record<string, unknown>) {
  const staffId = getString(params.staff_id);
  let query = admin
    .from('reservations')
    .select('tenant_staff_id, staff_id, discount_cents')
    .eq('tenant_id', tenantId)
    .gt('discount_cents', 0);

  if (staffId) {
    query = query.or(`tenant_staff_id.eq.${staffId},staff_id.eq.${staffId}`);
  }

  const { data, error } = await query;
  if (error) return { success: false, error: error.message };

  const totals = new Map<string, number>();
  for (const row of data ?? []) {
    const key = String(row.tenant_staff_id ?? row.staff_id ?? '');
    if (!key) continue;
    totals.set(key, (totals.get(key) ?? 0) + Number(row.discount_cents ?? 0));
  }

  const items = [...totals.entries()].map(([staff_id, discount_cents]) => ({ staff_id, discount_cents }));
  const reply = items.length
    ? `Staff discounts:\n${items.map((item) => `• ${item.staff_id}: ₦${Math.round(item.discount_cents / 100).toLocaleString()}`).join('\n')}`
    : 'No staff discounts found.';

  return { success: true, reply, data: { items } };
}

async function setStaffCapabilityExecute(
  admin: SupabaseClient,
  tenantId: string,
  params: Record<string, unknown>,
  ctx: ActionContext
) {
  const staffId = getString(params.staff_id);
  const capability = getString(params.capability);
  const enabled = typeof params.enabled === 'boolean' ? params.enabled : true;
  if (!staffId || !capability) {
    return { success: false, error: 'set_staff_capability requires staff_id and capability' };
  }

  await logAiAction(admin, {
    tenantId,
    actorType: 'user',
    actorId: ctx.actorId ?? null,
    channel: 'whatsapp',
    rawMessage: null,
    action: 'set_staff_capability',
    params: { staff_id: staffId, capability, enabled },
    idempotencyKey: `staff-capability:${tenantId}:${staffId}:${capability}:${enabled}`,
    validationResult: { deferred_to_permissions_spec: true },
    outcome: 'executed',
    model: 'system',
  });

  await recordBusinessEvent(admin, {
    tenantId,
    actorType: 'user',
    actorId: ctx.actorId ?? null,
    action: BUSINESS_EVENT_ACTIONS.STAFF_PERMISSION_CHANGED,
    entityType: 'tenant_user',
    entityId: staffId,
    source: 'whatsapp',
    metadata: { capability, enabled, deferred_to_permissions_spec: true },
  });

  return {
    success: true,
    reply: `Recorded capability intent for staff member ${staffId}: ${capability} ${enabled ? 'enabled' : 'disabled'}.`,
    data: { staff_id: staffId, capability, enabled },
  };
}

export const staffHandlers: Record<string, ActionHandler> = {
  staff_sales_query: {
    action: 'staff_sales_query',
    requiresConfirmation: false,
    async validate() {
      return { valid: true };
    },
    execute: staffSalesQueryExecute,
  },
  staff_discount_query: {
    action: 'staff_discount_query',
    requiresConfirmation: false,
    async validate() {
      return { valid: true };
    },
    execute: staffDiscountQueryExecute,
  },
  set_staff_capability: {
    action: 'set_staff_capability',
    capability: 'manage_staff',
    requiresConfirmation: true,
    async validate(_admin, _tenantId, params) {
      return getString(params.staff_id) && getString(params.capability)
        ? { valid: true }
        : { valid: false, error: 'set_staff_capability requires staff_id and capability' };
    },
    execute: setStaffCapabilityExecute,
  },
};
