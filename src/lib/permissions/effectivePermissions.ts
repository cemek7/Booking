import type { SupabaseClient } from '@supabase/supabase-js';
import { getAllPermissionsForRole } from '@/types/enhanced-permissions';
import type { Role } from '@/types/roles';

type TenantUserRow = {
  id: string;
  role: Role;
};

type OverrideRow = {
  permission: string;
  effect: 'grant' | 'revoke';
};

export async function getEffectivePermissions(
  admin: SupabaseClient,
  tenantId: string,
  tenantUserId: string
): Promise<Set<string>> {
  const [{ data: tenantUser, error: tenantUserError }, { data: overrides, error: overridesError }] =
    await Promise.all([
      admin
        .from('tenant_users')
        .select('id, role')
        .eq('tenant_id', tenantId)
        .eq('id', tenantUserId)
        .maybeSingle<TenantUserRow>(),
      admin
        .from('tenant_user_permissions')
        .select('permission, effect')
        .eq('tenant_id', tenantId)
        .eq('tenant_user_id', tenantUserId),
    ]);

  if (tenantUserError) throw tenantUserError;
  if (!tenantUser) {
    throw new Error(`Tenant user ${tenantUserId} not found for tenant ${tenantId}`);
  }
  if (overridesError) throw overridesError;

  const granted = new Set(getAllPermissionsForRole(tenantUser.role));
  for (const row of ((overrides ?? []) as OverrideRow[])) {
    if (row.effect === 'grant') granted.add(row.permission);
    if (row.effect === 'revoke') granted.delete(row.permission);
  }

  return granted;
}
