/**
 * Server-rendered page auth helpers.
 *
 * Canonical usage:
 * - Server Components / page loaders: this module
 * - API routes: `src/lib/error-handling/route-handler.ts`
 *
 * Avoid adding new API-specific auth logic here.
 */
import { headers } from 'next/headers';
import { createServerSupabaseClient, createSupabaseAdminClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import type { Role } from '@/types/roles';
import { getInheritedRoles, ROLE_PERMISSION_MAP, isValidRole } from '@/types/index';
import { defaultLogger } from '@/lib/logger';
import { getEffectivePermissions } from '@/lib/permissions/effectivePermissions';

import type { AuthenticatedUser } from '@/types/auth';

export type { AuthenticatedUser };

export async function requireAuth(
  allowedRoles?: Role[],
  requireExact: boolean = false
): Promise<AuthenticatedUser> {
  const supabase = createServerSupabaseClient();
  const { data: { user }, error: sessionError } = await supabase.auth.getUser();

  defaultLogger.info('[requireAuth] Session lookup result', {
    hasUser: !!user,
    sessionError: sessionError?.message,
  });

  if (sessionError || !user) redirect('/booka/auth/signin');

  const headersList = await headers();
  const requestedTenantId = headersList.get('x-tenant-id');

  const adminSupabase = createSupabaseAdminClient();
  const normalizedEmail = user.email?.trim().toLowerCase() ?? '';
  const { data: adminByEmail, error: adminByEmailError } = normalizedEmail
    ? await adminSupabase
        .from('admins')
        .select('email, status')
        .eq('email', normalizedEmail)
        .maybeSingle()
    : { data: null, error: null };
  const isSuperadmin = !!adminByEmail;

  defaultLogger.info('[requireAuth] Admin lookup result', {
    userId: user.id,
    email: normalizedEmail || null,
    requestedTenantId,
    adminByEmail: !!adminByEmail,
    adminByUserId: false,
    adminByEmailError: adminByEmailError?.message,
    adminByUserIdError: null,
  });

  if (isSuperadmin) {
    const role: Role = 'superadmin';
    const effectiveRoles: Role[] = ['superadmin', 'owner', 'manager', 'staff'];

    defaultLogger.info('[requireAuth] Resolved superadmin user', {
      userId: user.id,
      email: normalizedEmail || null,
      requestedTenantId,
      allowedRoles,
      requireExact,
    });

    if (allowedRoles?.length) {
      const hasAccess = requireExact
        ? allowedRoles.includes(role)
        : effectiveRoles.some(r => allowedRoles.includes(r));
      if (!hasAccess) redirect('/booka/auth/forbidden');
    }

    return {
      id: user.id,
      email: user.email || '',
      role,
      tenantId: requestedTenantId || 'global',
      permissions: ROLE_PERMISSION_MAP[role] || [],
      effectiveRoles,
      is_active: true,
      created_at: user.created_at,
      updated_at: new Date().toISOString()
    };
  }

  const { data: memberships, error: roleError } = await supabase
    .from('tenant_users')
    .select('id, user_id, role, tenant_id')
    .eq('user_id', user.id)
    .order('tenant_id', { ascending: true });

  defaultLogger.info('[requireAuth] Tenant membership lookup result', {
    userId: user.id,
    email: normalizedEmail || null,
    requestedTenantId,
    roleError: roleError?.message,
    membershipCount: memberships?.length ?? 0,
    memberships: memberships?.map((membership) => ({
      tenant_id: membership.tenant_id,
      role: membership.role,
    })) ?? [],
  });

  if (roleError) redirect('/booka/auth/unauthorized');
  if (!memberships || memberships.length === 0) {
    defaultLogger.warn('[requireAuth] Redirecting to onboarding due to missing memberships', {
      userId: user.id,
      email: normalizedEmail || null,
      requestedTenantId,
    });
    redirect('/booka/auth/onboarding');
  }

  // Filter out any rows with null/invalid roles (can happen from buggy inserts)
  const validMemberships = memberships.filter(m => m.role && isValidRole(m.role as string));
  if (validMemberships.length === 0) {
    defaultLogger.warn('[requireAuth] Redirecting to onboarding due to invalid memberships', {
      userId: user.id,
      email: normalizedEmail || null,
      requestedTenantId,
      memberships: memberships.map((membership) => ({
        tenant_id: membership.tenant_id,
        role: membership.role,
      })),
    });
    redirect('/booka/auth/onboarding');
  }

  const tenantUserData = requestedTenantId
    ? validMemberships.find((membership) => membership.tenant_id === requestedTenantId) ?? null
    : validMemberships[0];

  if (!tenantUserData) redirect('/booka/auth/unauthorized');

  const role = tenantUserData.role as Role;
  const effectiveRoles: Role[] = [role, ...getInheritedRoles(role)];
  const effectivePermissions = Array.from(
    await getEffectivePermissions(adminSupabase, tenantUserData.tenant_id, tenantUserData.id)
  );

  if (allowedRoles?.length) {
    const hasAccess = requireExact
      ? allowedRoles.includes(role)
      : effectiveRoles.some(r => allowedRoles.includes(r));
    if (!hasAccess) redirect('/booka/auth/forbidden');
  }

  return {
    id: user.id,
    email: user.email || '',
    role,
    tenantId: tenantUserData.tenant_id,
    tenantUserId: tenantUserData.id,
    permissions: effectivePermissions,
    effectiveRoles,
    is_active: true,
    created_at: user.created_at,
    updated_at: new Date().toISOString()
  };
}

/**
 * Check if user has permission for a resource/action
 */
export function hasPermission(user: AuthenticatedUser, resource: string, action?: string): boolean {
  if (user?.role === 'superadmin') return true;
  const permKey = action ? `${resource}:${action}` : resource;
  return user?.permissions?.includes(permKey) ?? false;
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
