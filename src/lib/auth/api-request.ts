import { createSupabaseBearerClient } from '@/lib/supabase/bearer-client';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import type { Role } from '@/types/roles';
import { isValidRole } from '@/types/index';

export interface ApiTenantAccess {
  userId: string;
  email: string;
  tenantId: string;
  role: Role;
}

export async function resolveApiTenantAccess(
  request: Request,
  allowedRoles: Role[] = ['owner', 'manager']
): Promise<ApiTenantAccess> {
  const authHeader = request.headers.get('authorization') || '';
  if (!authHeader.startsWith('Bearer ')) {
    throw new Error('Unauthorized');
  }

  const token = authHeader.slice(7);
  const admin = createSupabaseAdminClient();
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  const user = userData.user;
  if (userError || !user) {
    throw new Error('Unauthorized');
  }

  const supabase = createSupabaseBearerClient(token);
  const { data: memberships, error } = await supabase
    .from('tenant_users')
    .select('tenant_id, role')
    .eq('user_id', user.id)
    .order('tenant_id', { ascending: true });

  if (error || !memberships?.length) {
    throw new Error('Forbidden');
  }

  const requestedTenantId = request.headers.get('x-tenant-id');
  const validMembership = requestedTenantId
    ? memberships.find((membership) => {
        if (!isValidRole(membership.role as string)) return false;
        return membership.tenant_id === requestedTenantId && allowedRoles.includes(membership.role as Role);
      })
    : memberships.find((membership) => {
        if (!isValidRole(membership.role as string)) return false;
        return allowedRoles.includes(membership.role as Role);
      });

  if (!validMembership) {
    throw new Error('Forbidden');
  }

  return {
    userId: user.id,
    email: user.email || '',
    tenantId: validMembership.tenant_id,
    role: validMembership.role as Role,
  };
}
