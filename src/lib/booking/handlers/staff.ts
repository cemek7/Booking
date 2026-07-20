import type { SupabaseClient } from '@supabase/supabase-js';
import { logAiAction } from '@/lib/ai/aiActionLog';
import { setPermissionOverride } from '@/lib/permissions/overrides';
import { getEffectivePermissions } from '@/lib/permissions/effectivePermissions';
import { BOOKA_PERMISSIONS } from '@/types/permissions';
import type { Role } from '@/types/roles';
import type { ActionHandler } from './registry';
import { decideApproval } from '@/lib/approvals/requests';

type ActionContext = { actorId?: string | null; role?: string; permissions?: string[] };

function getString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

const STAFF_CAPABILITY_PERMISSION_MAP: Record<string, string> = {
  refund: BOOKA_PERMISSIONS.ISSUE_REFUNDS,
  refunds: BOOKA_PERMISSIONS.ISSUE_REFUNDS,
  refund_sale: BOOKA_PERMISSIONS.ISSUE_REFUNDS,
  payment: BOOKA_PERMISSIONS.RECORD_PAYMENTS,
  payments: BOOKA_PERMISSIONS.RECORD_PAYMENTS,
  record_payment: BOOKA_PERMISSIONS.RECORD_PAYMENTS,
  record_payments: BOOKA_PERMISSIONS.RECORD_PAYMENTS,
  discount: BOOKA_PERMISSIONS.ISSUE_DISCOUNTS,
  discounts: BOOKA_PERMISSIONS.ISSUE_DISCOUNTS,
  stock: BOOKA_PERMISSIONS.ADJUST_INVENTORY,
  inventory: BOOKA_PERMISSIONS.ADJUST_INVENTORY,
  adjust_stock: BOOKA_PERMISSIONS.ADJUST_INVENTORY,
  sales: BOOKA_PERMISSIONS.RECORD_SALES,
  record_sales: BOOKA_PERMISSIONS.RECORD_SALES,
  staff: BOOKA_PERMISSIONS.MANAGE_STAFF,
  manage_staff: BOOKA_PERMISSIONS.MANAGE_STAFF,
};

function getPermissionFromCapability(capability: string): string | null {
  const key = capability.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return STAFF_CAPABILITY_PERMISSION_MAP[key] ?? null;
}

function normalizeActorRole(role?: string): Role {
  if (role === 'superadmin' || role === 'owner' || role === 'manager' || role === 'staff') {
    return role;
  }
  return 'owner';
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

  const permission = getPermissionFromCapability(capability);
  if (!permission) {
    return { success: false, error: `Unknown staff capability: ${capability}` };
  }

  const actorRole = normalizeActorRole(ctx.role);
  const actorId = ctx.actorId ?? null;
  if (!actorId) {
    return { success: false, error: 'set_staff_capability requires an authenticated actor' };
  }

  const actorPerms = await getEffectivePermissions(admin, tenantId, actorId);
  const override = enabled
    ? await setPermissionOverride(admin, {
        tenantId,
        targetUserId: staffId,
        permission,
        effect: 'grant',
        actorRole,
        actorPerms,
        actorUserId: actorId,
        reason: `AI command: ${capability} enabled`,
      })
    : await setPermissionOverride(admin, {
        tenantId,
        targetUserId: staffId,
        permission,
        effect: 'revoke',
        actorRole,
        actorPerms,
        actorUserId: actorId,
        reason: `AI command: ${capability} disabled`,
      });

  await logAiAction(admin, {
    tenantId,
    actorType: 'user',
    actorId,
    channel: 'whatsapp',
    rawMessage: null,
    action: 'set_staff_capability',
    params: { staff_id: staffId, capability, permission, enabled },
    idempotencyKey: `staff-capability:${tenantId}:${staffId}:${capability}:${enabled}`,
    validationResult: { permission, enabled, override_id: (override as { id?: string } | null)?.id ?? null },
    outcome: 'executed',
    model: 'system',
  });

  return {
    success: true,
    reply: `Updated staff permissions for ${staffId}: ${permission} ${enabled ? 'granted' : 'revoked'}.`,
    data: { staff_id: staffId, capability, permission, enabled },
  };
}

async function resolveApprovalExecute(
  admin: SupabaseClient,
  _tenantId: string,
  params: Record<string, unknown>,
  ctx: ActionContext
) {
  const requestId = getString(params.request_id);
  const decision = getString(params.decision)?.toLowerCase();
  const note = getString(params.note);

  if (!requestId || (decision !== 'approve' && decision !== 'reject')) {
    return { success: false, error: 'resolve_approval requires request_id and decision' };
  }
  if (!ctx.actorId) {
    return { success: false, error: 'resolve_approval requires an authenticated actor' };
  }

  const result = await decideApproval(admin, {
    requestId,
    actorId: ctx.actorId,
    actorPerms: ctx.permissions ?? [],
    decision,
    note,
  });

  return {
    success: true,
    reply: `Approval ${requestId} ${decision}d.`,
    data: { approval: result },
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
  resolve_approval: {
    action: 'resolve_approval',
    requiresConfirmation: true,
    async validate(_admin, _tenantId, params) {
      const requestId = getString(params.request_id);
      const decision = getString(params.decision)?.toLowerCase();
      if (!requestId || (decision !== 'approve' && decision !== 'reject')) {
        return { valid: false, error: 'resolve_approval requires request_id and decision' };
      }
      if (decision === 'reject' && !getString(params.note)) {
        return { valid: false, error: 'rejecting an approval requires a note' };
      }
      return { valid: true };
    },
    execute: resolveApprovalExecute,
  },
};
