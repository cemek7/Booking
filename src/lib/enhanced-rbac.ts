import type { SupabaseClient } from '@supabase/supabase-js';
import { Role, normalizeRole, SchemaValidationIssue, RoleHierarchyStats } from '@/types/roles';
import { 
  StrictUserWithRole, 
  StrictTenantUser,
  StrictPermissionResult, 
  TypeSafePermissionChecker,
  TypeSafePermissionError,
  assertRole
} from '@/types/type-safe-rbac';

/**
 * Enhanced RBAC helpers with proper tenant isolation and superadmin support
 * This replaces the basic rbac.ts with comprehensive security checks
 */

export interface TenantAccessContext {
  readonly userId: string;
  readonly tenantId: string;
  readonly userRole: Role;
  readonly isSuperAdmin: boolean;
}

/**
 * Legacy compatibility interface for validateTenantAccess
 */
export interface LegacyTenantValidation {
  canAccessTenant: boolean;
  role?: string;
  isSuperAdmin?: boolean;
}

/**
 * Get user role for a specific tenant with proper validation
 * Uses optimized indexes and role hierarchy
 */
export async function getUserRoleForTenant(
  supabase: SupabaseClient, 
  userId: string, 
  tenantId: string
): Promise<Role | null> {
  try {
    // Use optimized query with proper indexes
    const { data, error } = await supabase
      .from('tenant_users')
      .select('role')
      .eq('user_id', userId)
      .eq('tenant_id', tenantId)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();
    
    if (error) {
      console.warn('rbac: failed to fetch user role', error);
      return null;
    }
    
    if (!data?.role) return null;
    
    // Normalize legacy roles and validate with strict typing
    try {
      const normalizedRole = normalizeRole(data.role);
      return assertRole(normalizedRole, 'getUserRoleForTenant');
    } catch (err) {
      console.warn('rbac: invalid role found', data.role, err);
      return null;
    }
  } catch (e) {
    console.warn('rbac: failed to fetch user role', e);
    return null;
  }
}

/**
 * Check role-based access using database function (optimized)
 */
export async function checkRoleAccess(
  supabase: SupabaseClient,
  userId: string,
  tenantId: string,
  requiredRole: Role
): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('check_role_access', {
      user_id: userId,
      tenant_id: tenantId,
      required_role: requiredRole
    });
    
    if (error) {
      console.warn('rbac: role access check failed', error);
      return false;
    }
    
    return data === true;
  } catch (e) {
    console.warn('rbac: role access check error', e);
    return false;
  }
}

/**
 * Get role hierarchy stats for a tenant
 */
export async function getTenantRoleStats(
  supabase: SupabaseClient,
  tenantId: string
): Promise<RoleHierarchyStats | null> {
  try {
    const { data, error } = await supabase
      .from('role_hierarchy_stats')
      .select('*')
      .eq('tenant_id', tenantId)
      .maybeSingle();
    
    if (error) {
      console.warn('rbac: failed to fetch role stats', error);
      return null;
    }
    
    return data;
  } catch (e) {
    console.warn('rbac: role stats error', e);
    return null;
  }
}

/**
 * Check if user is a global admin (superadmin) by checking admins table
 */
export async function isGlobalAdmin(
  supabase: SupabaseClient, 
  userId?: string | null, 
  email?: string | null
): Promise<boolean> {
  if (!email) {
    // The 'admins' table is keyed by email, so we cannot check without it.
    // The userId is not consistently available in the admins table.
    if (userId) {
      console.warn(`isGlobalAdmin was called with userId (${userId}) but no email. Cannot perform admin check.`);
    }
    return false;
  }
  
  try {
    const { data, error } = await supabase
      .from('admins')
      .select('email')
      .eq('email', email)
      .maybeSingle();
    
    if (error) {
      // This will catch potential issues like the table not existing, but not a missing column
      // since we are only selecting 'email'.
      console.warn('rbac: failed to check admin status', error);
      return false;
    }
    
    return !!data;
  } catch (e) {
    console.warn('rbac: exception during admin status check', e);
    return false;
  }
}

/**
 * Backward compatibility alias for isGlobalAdmin
 */
export const checkGlobalAdmin = isGlobalAdmin;

/**
 * Legacy validateTenantAccess implementation for backward compatibility
 */
async function validateTenantAccessLegacy(
  supabase: SupabaseClient,
  user: { id: string; email?: string | null },
  tenantId: string,
  actorEmail?: string | null
): Promise<LegacyTenantValidation> {
  try {
    // Check if user is superadmin first
    const isSuperAdmin = await isGlobalAdmin(supabase, user.id, user.email ?? actorEmail);
    
    if (isSuperAdmin) {
      return {
        canAccessTenant: true,
        role: 'superadmin',
        isSuperAdmin: true
      };
    }
    
    // Get user role in the specific tenant
    const userRole = await getUserRoleForTenant(supabase, user.id, tenantId);
    
    if (!userRole) {
      return {
        canAccessTenant: false
      };
    }
    
    return {
      canAccessTenant: true,
      role: userRole,
      isSuperAdmin: false
    };
  } catch (e) {
    console.error('rbac: failed to validate tenant access (legacy)', e);
    return {
      canAccessTenant: false
    };
  }
}

/**
 * Validate tenant access with comprehensive security checks
 * Supports both new signature (requiredRoles) and legacy signature (actorEmail)
 */
export async function validateTenantAccess(
  supabase: SupabaseClient,
  user: { id: string; email?: string | null },
  tenantId: string,
  requiredRolesOrEmail?: Role[] | string | null
): Promise<TenantAccessContext | LegacyTenantValidation | null> {
  // Handle legacy signature (4th param is email string)
  if (typeof requiredRolesOrEmail === 'string' || requiredRolesOrEmail === null) {
    return validateTenantAccessLegacy(supabase, user, tenantId, requiredRolesOrEmail);
  }
  
  // Handle new signature (4th param is Role array)
  const requiredRoles = (Array.isArray(requiredRolesOrEmail) ? requiredRolesOrEmail : []) as Role[];
  
  try {
    // Check if user is superadmin first
    const isSuperAdmin = await isGlobalAdmin(supabase, user.id, user.email);
    
    // Superadmins can access any tenant
    if (isSuperAdmin) {
      return {
        userId: user.id,
        tenantId,
        userRole: 'superadmin',
        isSuperAdmin: true
      };
    }
    
    // Get user role in the specific tenant
    const userRole = await getUserRoleForTenant(supabase, user.id, tenantId);
    
    if (!userRole) {
      return null; // User not a member of this tenant
    }
    
    // Check if user has required role
    if (requiredRoles.length > 0) {
      const hasRequiredRole = requiredRoles.some(requiredRole => {
        // Simple role hierarchy check
        if (userRole === 'owner') return true;
        if (userRole === 'manager' && ['manager', 'staff'].includes(requiredRole)) return true;
        if (userRole === 'staff' && requiredRole === 'staff') return true;
        return userRole === requiredRole;
      });
      
      if (!hasRequiredRole) {
        return null; // Insufficient permissions
      }
    }
    
    return {
      userId: user.id,
      tenantId,
      userRole,
      isSuperAdmin: false
    };
  } catch (e) {
    console.error('rbac: failed to validate tenant access', e);
    return null;
  }
}

/**
 * Ensure user has owner-level access to tenant
 */
export async function ensureOwnerForTenant(
  supabase: SupabaseClient, 
  user: { id: string; email?: string | null }, 
  tenantId: string
): Promise<boolean> {
  const access = await validateTenantAccess(supabase, user, tenantId, ['owner']);
  
  if (!access) {
    throw new Error('forbidden: owner access required');
  }
  
  // Type guard for TenantAccessContext
  if ('userRole' in access) {
    // Superadmin or owner role
    if (access.isSuperAdmin || access.userRole === 'owner') {
      return true;
    }
  }
  
  throw new Error('forbidden: owner role required');
}

/**
 * Ensure user has manager-level or higher access to tenant
 */
export async function ensureManagerForTenant(
  supabase: SupabaseClient, 
  user: { id: string; email?: string | null }, 
  tenantId: string
): Promise<boolean> {
  const access = await validateTenantAccess(supabase, user, tenantId, ['manager', 'owner']);
  
  if (!access) {
    throw new Error('forbidden: manager access required');
  }
  
  // Type guard for TenantAccessContext
  if ('userRole' in access) {
    // Superadmin, owner, or manager role
    if (access.isSuperAdmin || ['owner', 'manager'].includes(access.userRole)) {
      return true;
    }
  }
  
  throw new Error('forbidden: manager role required');
}

/**
 * Audit superadmin action for security logging
 */
export async function auditSuperadminAction(
  supabase: SupabaseClient,
  adminUserId: string,
  action: string,
  targetTenantId?: string,
  targetUserId?: string,
  targetResource?: string,
  requestDetails?: Record<string, unknown>,
  ipAddress?: string,
  userAgent?: string
): Promise<void> {
  try {
    // Insert audit log entry
    const { error } = await supabase
      .from('superadmin_audit_log')
      .insert({
        admin_user_id: adminUserId,
        action,
        target_tenant_id: targetTenantId,
        target_user_id: targetUserId,
        target_resource: targetResource,
        request_details: requestDetails || {},
        ip_address: ipAddress,
        user_agent: userAgent,
        created_at: new Date().toISOString()
      });
    
    if (error) {
      console.error('Failed to log superadmin action', error);
    }
  } catch (e) {
    console.error('Failed to audit superadmin action', e);
  }
}

/**
 * Validate request and extract user context with comprehensive security
 */
export async function validateRequest(
  supabase: SupabaseClient,
  request: Request
): Promise<TenantAccessContext | null> {
  try {
    // Extract authorization token
    const authHeader = request.headers.get('authorization') || request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }
    
    const token = authHeader.split(' ')[1];
    const { data: userData, error } = await supabase.auth.getUser(token);
    
    if (error || !userData?.user) {
      return null;
    }
    
    const user = userData.user;
    
    // Extract tenant ID from request (could be in URL params, body, or headers)
    const url = new URL(request.url);
    const tenantId = url.searchParams.get('tenant_id') || 
                    url.pathname.split('/').find(segment => segment.match(/^[0-9a-f-]{36}$/i));
    
    if (!tenantId) {
      return null;
    }
    
    const result = await validateTenantAccess(supabase, { id: user.id, email: user.email }, tenantId);
    
    // Type guard to ensure we return TenantAccessContext
    if (result && 'userRole' in result) {
      return result;
    }
    
    return null;
  } catch (e) {
    console.error('Failed to validate request', e);
    return null;
  }
}

/**
 * Validate database schema alignment
 */
export async function validateSchemaAlignment(
  supabase: SupabaseClient
): Promise<SchemaValidationIssue[]> {
  try {
    const { data, error } = await supabase.rpc('validate_schema_alignment');
    
    if (error) {
      console.error('schema: validation failed', error);
      return [{
        table_name: 'system',
        issue_type: 'validation_error',
        issue_description: `Schema validation failed: ${error.message}`,
        severity: 'critical'
      }];
    }
    
    return data || [];
  } catch (e) {
    console.error('schema: validation error', e);
    return [{
      table_name: 'system',
      issue_type: 'system_error',
      issue_description: `System error during validation: ${e}`,
      severity: 'critical'
    }];
  }
}

/**
 * Refresh role hierarchy statistics
 */
export async function refreshRoleHierarchyStats(
  supabase: SupabaseClient
): Promise<boolean> {
  try {
    const { error } = await supabase.rpc('refresh_role_hierarchy_stats');
    
    if (error) {
      console.error('schema: failed to refresh stats', error);
      return false;
    }
    
    return true;
  } catch (e) {
    console.error('schema: refresh stats error', e);
    return false;
  }
}

const enhancedRbac = { 
  getUserRoleForTenant, 
  isGlobalAdmin, 
  checkGlobalAdmin,
  validateTenantAccess,
  ensureOwnerForTenant, 
  ensureManagerForTenant,
  auditSuperadminAction,
  validateRequest,
  checkRoleAccess,
  getTenantRoleStats,
  validateSchemaAlignment,
  refreshRoleHierarchyStats
};

export default enhancedRbac;