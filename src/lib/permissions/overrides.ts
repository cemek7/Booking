import type { SupabaseClient } from '@supabase/supabase-js';
import { BOOKA_PERMISSIONS } from '@/types/permissions';
import type { Role } from '@/types/roles';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { BUSINESS_EVENT_ACTIONS, recordBusinessEvent } from '@/lib/audit/businessEvents';

type OverrideEffect = 'grant' | 'revoke';

type TargetTenantUserRow = {
  id: string;
  user_id?: string | null;
  role: Role;
};

type ExistingOverrideRow = {
  id: string;
  permission: string;
  effect: OverrideEffect;
  reason?: string | null;
};

export interface SetPermissionOverrideInput {
  tenantId: string;
  targetUserId: string;
  permission: string;
  effect: OverrideEffect;
  actorRole: Role;
  actorPerms: Set<string>;
  actorUserId: string;
  reason?: string | null;
}

export interface ResetPermissionOverrideInput {
  tenantId: string;
  targetUserId: string;
  permission: string;
  actorRole: Role;
  actorPerms: Set<string>;
  actorUserId: string;
  reason?: string | null;
}

async function getTargetTenantUser(
  admin: SupabaseClient,
  tenantId: string,
  tenantUserId: string
): Promise<TargetTenantUserRow> {
  const { data, error } = await admin
    .from('tenant_users')
    .select('id, user_id, role')
    .eq('tenant_id', tenantId)
    .eq('id', tenantUserId)
    .maybeSingle<TargetTenantUserRow>();

  if (error) throw error;
  if (!data) {
    throw ApiErrorFactory.notFound('Target staff member');
  }

  return data;
}

function assertOverrideGuards(
  actorRole: Role,
  actorPerms: Set<string>,
  targetRole: Role,
  permission: string,
  effect: OverrideEffect
) {
  if (actorRole !== 'superadmin' && !actorPerms.has(BOOKA_PERMISSIONS.MANAGE_STAFF)) {
    throw ApiErrorFactory.forbidden('MANAGE_STAFF is required to change staff permissions');
  }

  if (targetRole === 'owner' && effect === 'revoke') {
    throw ApiErrorFactory.forbidden('Owner permissions are protected from revocation');
  }

  if (actorRole !== 'superadmin' && effect === 'grant' && !actorPerms.has(permission)) {
    throw ApiErrorFactory.forbidden('You can only grant permissions that you already hold');
  }
}

export async function setPermissionOverride(
  admin: SupabaseClient,
  input: SetPermissionOverrideInput
) {
  const target = await getTargetTenantUser(admin, input.tenantId, input.targetUserId);
  assertOverrideGuards(
    input.actorRole,
    input.actorPerms,
    target.role,
    input.permission,
    input.effect
  );

  const { data: existing, error: existingError } = await admin
    .from('tenant_user_permissions')
    .select('id, permission, effect, reason')
    .eq('tenant_id', input.tenantId)
    .eq('tenant_user_id', input.targetUserId)
    .eq('permission', input.permission)
    .maybeSingle<ExistingOverrideRow>();

  if (existingError) throw existingError;

  const nowIso = new Date().toISOString();
  const payload = {
    tenant_id: input.tenantId,
    tenant_user_id: input.targetUserId,
    permission: input.permission,
    effect: input.effect,
    reason: input.reason?.trim() || null,
    created_by: input.actorUserId,
    updated_at: nowIso,
  };

  const { data, error } = await admin
    .from('tenant_user_permissions')
    .upsert(payload, { onConflict: 'tenant_id,tenant_user_id,permission' })
    .select('*')
    .single();

  if (error) throw error;

  await recordBusinessEvent(admin, {
    tenantId: input.tenantId,
    actorType: 'user',
    actorId: input.actorUserId,
    action: BUSINESS_EVENT_ACTIONS.STAFF_PERMISSION_CHANGED,
    entityType: 'tenant_user',
    entityId: input.targetUserId,
    source: 'dashboard',
    before: existing ?? null,
    after: data,
    reason: input.reason?.trim() || null,
    metadata: {
      permission: input.permission,
      effect: input.effect,
      target_role: target.role,
    },
  });

  return data;
}

export async function resetPermissionOverride(
  admin: SupabaseClient,
  input: ResetPermissionOverrideInput
) {
  const target = await getTargetTenantUser(admin, input.tenantId, input.targetUserId);
  if (input.actorRole !== 'superadmin' && !input.actorPerms.has(BOOKA_PERMISSIONS.MANAGE_STAFF)) {
    throw ApiErrorFactory.forbidden('MANAGE_STAFF is required to reset staff permissions');
  }
  if (target.role === 'owner') {
    throw ApiErrorFactory.forbidden('Owner permissions are protected from reset');
  }

  const { data: existing, error: existingError } = await admin
    .from('tenant_user_permissions')
    .select('id, permission, effect, reason')
    .eq('tenant_id', input.tenantId)
    .eq('tenant_user_id', input.targetUserId)
    .eq('permission', input.permission)
    .maybeSingle<ExistingOverrideRow>();

  if (existingError) throw existingError;
  if (!existing) return null;

  const { error } = await admin
    .from('tenant_user_permissions')
    .delete()
    .eq('tenant_id', input.tenantId)
    .eq('tenant_user_id', input.targetUserId)
    .eq('permission', input.permission);

  if (error) throw error;

  await recordBusinessEvent(admin, {
    tenantId: input.tenantId,
    actorType: 'user',
    actorId: input.actorUserId,
    action: BUSINESS_EVENT_ACTIONS.STAFF_PERMISSION_CHANGED,
    entityType: 'tenant_user',
    entityId: input.targetUserId,
    source: 'dashboard',
    before: existing,
    after: null,
    reason: input.reason?.trim() || null,
    metadata: {
      permission: input.permission,
      effect: 'reset',
      target_role: target.role,
    },
  });

  return existing;
}
