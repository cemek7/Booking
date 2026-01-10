import { getSupabaseServerComponentClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import type { Role } from './unified-auth-orchestrator';
import { UnifiedAuthOrchestrator } from './unified-auth-orchestrator';

// PHASE 2D: Import canonical auth types from consolidated location
import type { AuthenticatedUser } from '@/types/auth';

// Re-export for backward compatibility
export type { AuthenticatedUser };

/**
 * PHASE 2D: Simplified server-side authentication
 * Delegates to UnifiedAuthOrchestrator for core functionality
 */
export async function requireAuth(
  allowedRoles?: Role[],
  requireExact: boolean = false
): Promise<AuthenticatedUser> {
  const supabase = getSupabaseServerComponentClient();
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();

  if (sessionError || !session) redirect('/auth/signin');

  const { data: tenantUserData, error: roleError } = await supabase
    .from('tenant_users')
    .select('user_id, role, tenant_id')
    .eq('user_id', session.user.id)
    .single();

  if (roleError || !tenantUserData) redirect('/auth/unauthorized');

  const role = tenantUserData.role as Role;
  const orchestrator = UnifiedAuthOrchestrator.getInstance();
  const effectiveRoles = orchestrator.getEffectiveRoles(role);

  if (allowedRoles?.length) {
    const hasAccess = requireExact
      ? allowedRoles.includes(role)
      : effectiveRoles.some(r => allowedRoles.includes(r));
    if (!hasAccess) redirect('/auth/forbidden');
  }

  return {
    id: session.user.id,
    email: session.user.email || '',
    role,
    tenantId: tenantUserData.tenant_id,
    permissions: orchestrator.getPermissionsForRole(role),
    effectiveRoles,
    is_active: true,
    created_at: session.user.created_at,
    updated_at: new Date().toISOString()
  };
}

/**
 * Check if user has permission for a resource/action
 */
export function hasPermission(user: AuthenticatedUser, _resource: string, _action?: string): boolean {
  return user?.role === 'superadmin' || !!user?.permissions?.length;
}

/**
 * Validate user has access to requested tenant
 */
export function validateTenantAccess(user: AuthenticatedUser, requestedTenantId: string): boolean {
  return user?.role === 'superadmin' || user?.tenantId === requestedTenantId;
}

/**
 * Convenience wrapper for manager-level access
 */
export async function requireManagerAccess(): Promise<AuthenticatedUser> {
  return requireAuth(['manager', 'owner', 'superadmin']);
}

/**
 * Convenience wrapper for owner-level access
 */
export async function requireOwnerAccess(): Promise<AuthenticatedUser> {
  return requireAuth(['owner', 'superadmin']);
}

/**
 * Convenience wrapper for staff-level access
 */
export async function requireStaffAccess(): Promise<AuthenticatedUser> {
  return requireAuth(['staff', 'manager', 'owner', 'superadmin']);
}

/**
 * Convenience wrapper for superadmin-level access
 */
export async function requireSuperAdminAccess(): Promise<AuthenticatedUser> {
  return requireAuth(['superadmin'], true);
}

/**
 * Get role from middleware headers (fallback utility)
 */
export async function getRoleFromHeaders(): Promise<{ role: string; tenantId: string } | null> {
  try {
    const headersList = await headers();
    const role = headersList.get('x-user-role');
    const tenantId = headersList.get('x-tenant-id');
    return role && tenantId ? { role, tenantId } : null;
  } catch {
    return null;
  }
}