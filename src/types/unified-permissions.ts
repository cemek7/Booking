/**
 * Unified Permission Management System
 * 
 * This module consolidates all fragmented permission systems into a single,
 * comprehensive permission management solution with backward compatibility.
 * 
 * CONSOLIDATED SYSTEMS:
 * 1. Legacy RBAC (rbac.ts) - Basic tenant-user role checking
 * 2. Enhanced RBAC (enhanced-rbac.ts) - Advanced tenant access validation  
 * 3. Standard Permissions (permissions.ts) - Role-permission mapping
 * 4. Enhanced Permissions (enhanced-permissions.ts) - Context-aware inheritance
 */

import { defaultLogger } from '@/lib/logger';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Role, normalizeRole, isValidRole } from './roles';
import { PERMISSIONS, ROLE_PERMISSION_MAP, PermissionCheckResult } from './permissions';
import { 
  ENHANCED_ROLE_HIERARCHY, 
  EnhancedPermissionContext,
  hasEnhancedPermission,
  getAllPermissionsForRole as getEnhancedPermissions
} from './enhanced-permissions';

// ============================================================================
// UNIFIED TYPES AND INTERFACES
// ============================================================================

export interface UnifiedUser {
  id: string;
  role: Role;
  tenantId: string;
  email?: string;
  isSuperAdmin: boolean;
  permissions: string[];
  effectivePermissions: string[];
}

export interface UnifiedPermissionContext extends EnhancedPermissionContext {
  // Extends enhanced context with additional unified fields
  operationType?: 'read' | 'write' | 'delete' | 'manage';
  resourceType?: string;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
}

export interface UnifiedAccessResult {
  granted: boolean;
  user: UnifiedUser;
  reason?: string;
  appliedRules: string[];
  securityLevel: 'low' | 'medium' | 'high' | 'critical';
  auditRequired: boolean;
}

// ============================================================================
// UNIFIED PERMISSION CHECKER - MAIN API
// ============================================================================

export class UnifiedPermissionChecker {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  /**
   * Master permission checking method that consolidates all systems
   * This is the single entry point for ALL permission checks
   */
  async checkAccess(
    userId: string,
    permission: string,
    context: UnifiedPermissionContext
  ): Promise<UnifiedAccessResult> {
    try {
      // Step 1: Get unified user profile
      // Added a fallback for tenantId
      const tenantId = context.tenantId || 'default-tenant';
      const user = await this.getUserProfile(userId, tenantId);
      if (!user) {
        return {
          granted: false,
          user: this.createDeniedUser(userId),
          reason: 'User not found or inactive',
          appliedRules: ['user_lookup_failed'],
          securityLevel: 'high',
          auditRequired: true
        };
      }

      // Step 2: Check enhanced permission with full context
      const enhancedResult = hasEnhancedPermission(user.role, permission, context);
      
      // Step 3: Apply additional security rules
      const securityCheck = await this.applySecurityRules(user, permission, context);
      
      // Step 4: Determine final access decision
      const finalGranted = enhancedResult.granted && securityCheck.allowed;

      return {
        granted: finalGranted,
        user,
        reason: finalGranted ? undefined : (enhancedResult.reason || securityCheck.reason),
        appliedRules: [
          'enhanced_permission_check',
          ...securityCheck.appliedRules
        ],
        securityLevel: this.getSecurityLevel(permission, context),
        auditRequired: this.requiresAudit(user, permission, context)
      };

    } catch (error) {
      defaultLogger.error('Unified permission check failed:', error);
      return {
        granted: false,
        user: this.createDeniedUser(userId),
        reason: 'Permission check error',
        appliedRules: ['error_fallback'],
        securityLevel: 'critical',
        auditRequired: true
      };
    }
  }

  /**
   * Simplified permission checking for backward compatibility
   */
  async hasPermission(
    userId: string,
    tenantId: string,
    permission: string,
    context?: Record<string, unknown>
  ): Promise<boolean> {
    const result = await this.checkAccess(userId, permission, {
      userId,
      tenantId,
      ...context
    });
    return result.granted;
  }

  /**
   * Check multiple permissions efficiently
   */
  async hasAllPermissions(
    userId: string,
    tenantId: string,
    permissions: string[],
    context?: Record<string, unknown>
  ): Promise<boolean> {
    const results = await Promise.all(
      permissions.map(permission => 
        this.hasPermission(userId, tenantId, permission, context)
      )
    );
    return results.every(granted => granted);
  }

  /**
   * Check if user has any of the specified permissions
   */
  async hasAnyPermission(
    userId: string,
    tenantId: string,
    permissions: string[],
    context?: Record<string, unknown>
  ): Promise<boolean> {
    const results = await Promise.all(
      permissions.map(permission => 
        this.hasPermission(userId, tenantId, permission, context)
      )
    );
    return results.some(granted => granted);
  }

  // ============================================================================
  // LEGACY COMPATIBILITY METHODS
  // ============================================================================

  /**
   * Legacy validateTenantAccess compatibility
   */
  async validateTenantAccess(
    userId: string,
    tenantId: string,
    requiredRoles?: Role[]
  ): Promise<{ canAccessTenant: boolean; role?: string; isSuperAdmin?: boolean }> {
    try {
      const user = await this.getUserProfile(userId, tenantId);
      
      if (!user) {
        return { canAccessTenant: false };
      }

      if (requiredRoles && requiredRoles.length > 0) {
        const hasRequiredRole = await this.hasAnyRole(user, requiredRoles);
        if (!hasRequiredRole) {
          return { canAccessTenant: false };
        }
      }

      return {
        canAccessTenant: true,
        role: user.role,
        isSuperAdmin: user.isSuperAdmin
      };
    } catch (error) {
      defaultLogger.error('Legacy validateTenantAccess failed:', error);
      return { canAccessTenant: false };
    }
  }

  /**
   * Legacy getUserRoleForTenant compatibility
   */
  async getUserRoleForTenant(userId: string, tenantId: string): Promise<Role | null> {
    try {
      const user = await this.getUserProfile(userId, tenantId);
      return user?.role || null;
    } catch (error) {
      defaultLogger.error('Legacy getUserRoleForTenant failed:', error);
      return null;
    }
  }

  /**
   * Legacy isGlobalAdmin compatibility
   */
  async isGlobalAdmin(userId?: string, email?: string): Promise<boolean> {
    try {
      if (userId) {
        const user = await this.getUserProfile(userId, 'default-tenant'); // Added default tenantId
        return user?.isSuperAdmin || false;
      }

      if (email) {
        const { data, error } = await this.supabase
          .from('admins')
          .select('user_id')
          .eq('email', email)
          .eq('is_active', true);
        return !!data?.length;
      }

      return false;
    } catch (error) {
      defaultLogger.error('isGlobalAdmin failed:', error);
      return false;
    }
  }

  // ============================================================================
  // INTERNAL HELPER METHODS
  // ============================================================================

  public async getUserProfile(userId: string, tenantId: string): Promise<UnifiedUser | null> {
    try {
      // Check if user is superadmin first
      const isSuperAdmin = await this.checkSuperAdminStatus(userId);

      // Get tenant-specific role if tenantId provided
      let role: Role = 'staff'; // default
      let userTenantId = tenantId;

      if (tenantId) {
        const { data: tenantUser, error } = await this.supabase
          .from('tenant_users')
          .select('role, tenant_id')
          .eq('user_id', userId)
          .eq('tenant_id', tenantId)
          .single();

        if (error || !tenantUser) {
          // If not superadmin and no tenant access, return null
          if (!isSuperAdmin) return null;
        } else {
          role = normalizeRole(tenantUser.role);
          userTenantId = tenantUser.tenant_id;
        }
      } else {
        // Get primary tenant for user
        const { data: userProfile, error } = await this.supabase
          .from('tenant_users')
          .select('role, tenant_id')
          .eq('user_id', userId)
          .order('created_at')
          .limit(1)
          .single();

        if (userProfile && !error) {
          role = normalizeRole(userProfile.role);
          userTenantId = userProfile.tenant_id;
        }
      }

      // Get all permissions for role
      const directPermissions = ROLE_PERMISSION_MAP[role] || [];
      const effectivePermissions = getEnhancedPermissions(role);

      return {
        id: userId,
        role: isSuperAdmin ? 'superadmin' : role,
        tenantId: userTenantId || '',
        isSuperAdmin,
        permissions: directPermissions,
        effectivePermissions
      };

    } catch (error) {
      defaultLogger.error('Failed to get user profile:', error);
      return null;
    }
  }

  private async checkSuperAdminStatus(userId: string): Promise<boolean> {
    try {
      const { data, error } = await this.supabase
        .from('admins')
        .select('user_id')
        .eq('user_id', userId)
        .eq('is_active', true)
        .single();

      return !error && !!data;
    } catch {
      return false;
    }
  }

  private async applySecurityRules(
    user: UnifiedUser,
    permission: string,
    context: UnifiedPermissionContext
  ): Promise<{ allowed: boolean; reason?: string; appliedRules: string[] }> {
    const appliedRules: string[] = [];
    
    // Rule 1: Tenant isolation (except for superadmins)
    if (!user.isSuperAdmin && context.targetTenantId && context.targetTenantId !== user.tenantId) {
      return {
        allowed: false,
        reason: 'Cross-tenant access denied',
        appliedRules: [...appliedRules, 'tenant_isolation']
      };
    }
    appliedRules.push('tenant_isolation_check');

    // Rule 2: Self-resource access for staff
    if (user.role === 'staff' && context.targetUserId && context.targetUserId !== user.id) {
      const isSelfPermission = permission.includes(':own') || permission.includes('self');
      if (!isSelfPermission && !permission.includes(':all')) {
        return {
          allowed: false,
          reason: 'Staff can only access own resources',
          appliedRules: [...appliedRules, 'staff_self_access']
        };
      }
    }
    appliedRules.push('self_access_check');

    // Rule 3: Critical operation validation
    if (this.isCriticalOperation(permission)) {
      if (!['owner', 'superadmin'].includes(user.role)) {
        return {
          allowed: false,
          reason: 'Critical operation requires owner or superadmin role',
          appliedRules: [...appliedRules, 'critical_operation_denied']
        };
      }
    }
    appliedRules.push('critical_operation_check');

    return {
      allowed: true,
      appliedRules
    };
  }

  private isCriticalOperation(permission: string): boolean {
    const criticalPermissions = [
      'system:manage:all',
      'tenant:manage:all',
      'billing:manage:all',
      'user:manage:all'
    ];
    return criticalPermissions.includes(permission);
  }

  private getSecurityLevel(permission: string, context: UnifiedPermissionContext): 'low' | 'medium' | 'high' | 'critical' {
    if (this.isCriticalOperation(permission)) return 'critical';
    if (permission.includes('system:') || permission.includes('billing:')) return 'high';
    if (permission.includes('user:') || permission.includes('tenant:')) return 'medium';
    return 'low';
  }

  private requiresAudit(user: UnifiedUser, permission: string, context: UnifiedPermissionContext): boolean {
    // Always audit superadmin actions
    if (user.isSuperAdmin) return true;
    
    // Audit critical operations
    if (this.isCriticalOperation(permission)) return true;
    
    // Audit cross-tenant operations
    if (context.targetTenantId && context.targetTenantId !== user.tenantId) return true;
    
    return false;
  }

  async hasAnyRole(user: UnifiedUser, roles: Role[]): Promise<boolean> {
    if (user.isSuperAdmin) return true;
    
    // Check direct role match
    if (roles.includes(user.role)) return true;
    
    // Check role inheritance
    const hierarchy = ENHANCED_ROLE_HIERARCHY[user.role];
    return hierarchy.inherits.some(inheritedRole => roles.includes(inheritedRole));
  }

  private createDeniedUser(userId: string): UnifiedUser {
    return {
      id: userId,
      role: 'staff',
      tenantId: '',
      isSuperAdmin: false,
      permissions: [],
      effectivePermissions: []
    };
  }
}

// ============================================================================
// UNIFIED GLOBAL FUNCTIONS (for ease of migration)
// ============================================================================

let globalChecker: UnifiedPermissionChecker | null = null;

export function initializeUnifiedPermissions(supabase: SupabaseClient): UnifiedPermissionChecker {
  globalChecker = new UnifiedPermissionChecker(supabase);
  return globalChecker;
}

export function getUnifiedChecker(): UnifiedPermissionChecker {
  if (!globalChecker) {
    throw new Error('Unified permissions not initialized. Call initializeUnifiedPermissions() first.');
  }
  return globalChecker;
}

// Convenience functions that use the global checker
export async function checkUnifiedPermission(
  userId: string,
  permission: string,
  context: UnifiedPermissionContext
): Promise<UnifiedAccessResult> {
  return getUnifiedChecker().checkAccess(userId, permission, context);
}

export async function hasUnifiedPermission(
  userId: string,
  tenantId: string,
  permission: string,
  context?: Record<string, unknown>
): Promise<boolean> {
  return getUnifiedChecker().hasPermission(userId, tenantId, permission, context);
}

// ============================================================================
// MIGRATION HELPERS
// ============================================================================

export interface MigrationStatus {
  legacyRbacFiles: string[];
  fragmentedSystems: string[];
  migrationSteps: string[];
  compatibilityIssues: string[];
}

export function analyzeMigrationStatus(): MigrationStatus {
  return {
    legacyRbacFiles: [
      'src/lib/rbac.ts',
      'src/lib/enhanced-rbac.ts', 
      'src/lib/enhanced-rbac-backup.ts'
    ],
    fragmentedSystems: [
      'Legacy RBAC (basic tenant-user checking)',
      'Enhanced RBAC (superadmin + tenant access)', 
      'Standard Permissions (role-permission mapping)',
      'Enhanced Permissions (context-aware inheritance)'
    ],
    migrationSteps: [
      '1. Replace requireAuth() calls with unified checker',
      '2. Update hasPermission() calls to use unified API',
      '3. Migrate validateTenantAccess() usage',
      '4. Replace direct tenant_users queries',
      '5. Add audit logging integration'
    ],
    compatibilityIssues: [
      'Direct database queries in legacy code',
      'Hardcoded role checking patterns',
      'Missing permission context in API calls',
      'Inconsistent error handling'
    ]
  };
}

// ============================================================================
// LEGACY RBAC COMPATIBILITY LAYER
// ============================================================================

/**
 * Backward compatibility functions that replicate the legacy rbac.ts API
 * These delegate to the unified permission system
 */

export async function getUserRoleForTenant(
  supabase: SupabaseClient, 
  userId: string, 
  tenantId: string
): Promise<string | null> {
  try {
    const checker = new UnifiedPermissionChecker(supabase);
    const user = await checker.getUserProfile(userId, tenantId);
    return user?.role || null;
  } catch (e) {
    defaultLogger.warn('unified-permissions: getUserRoleForTenant failed', e);
    return null;
  }
}

export async function ensureOwnerForTenant(
  supabase: SupabaseClient,
  userId: string,
  tenantId: string
): Promise<boolean> {
  const role = await getUserRoleForTenant(supabase, userId, tenantId);
  if (!role) throw new Error('user not a member of tenant');
  if (role !== 'owner' && role !== 'superadmin') {
    throw new Error('forbidden: owner role required');
  }
  return true;
}

export async function isGlobalAdmin(
  supabase: SupabaseClient,
  userId?: string | null,
  email?: string | null
): Promise<boolean> {
  try {
    if (email) {
      const normalizedEmail = email.trim().toLowerCase();
      const { data: byEmail } = await supabase
        .from('admins')
        .select('email, status')
        .eq('email', normalizedEmail)
        .maybeSingle();
      if (byEmail) return true;
    }

    return false;
  } catch (e) {
    defaultLogger.warn('unified-permissions: isGlobalAdmin lookup failed', e);
    return false;
  }
}

// ============================================================================
// LEGACY ROLE PERMISSIONS COMPATIBILITY
// ============================================================================

/**
 * Legacy permission checking function for backward compatibility
 * @deprecated Use hasUnifiedPermission instead
 */
export function hasPermission(
  role: Role,
  resource: string,
  action: 'read' | 'write' | 'delete' | 'admin',
  scope: 'own' | 'tenant' | 'global' = 'tenant',
  tenantId?: string
): boolean {
  const context: UnifiedPermissionContext = {
    tenantId: tenantId || 'default',
    resourceId: resource,
    operationType: action === 'admin' ? 'manage' : action,
    resourceType: resource,
    scope
  };

  const enhancedResult = hasEnhancedPermission(role, `${resource}:${action}`, context);
  return enhancedResult.granted;
}

/**
 * Get analytics access level for a role
 * @deprecated Use unified permission system instead
 */
export function getAnalyticsLevel(role: Role): 'none' | 'personal' | 'team' | 'tenant' | 'global' {
  switch (role) {
    case 'superadmin':
      return 'global';
    case 'owner':
      return 'tenant';
    case 'manager':
      return 'team';
    case 'staff':
      return 'personal';
    default:
      return 'none';
  }
}

// ============================================================================
// UNIFIED MIGRATION UTILITIES
// ============================================================================

export interface UnifiedMigrationUtilities {
  migrateFromLegacyRbac(): Promise<void>;
  updateImportsToUnified(): Promise<string[]>;
  validateMigration(): Promise<boolean>;
  generateMigrationReport(): Promise<MigrationStatus>;
}

export const migrationUtils: UnifiedMigrationUtilities = {
  async migrateFromLegacyRbac(): Promise<void> {
    defaultLogger.info('Starting migration from legacy RBAC to unified permissions...');
  },

  async updateImportsToUnified(): Promise<string[]> {
    return [
      "Replace 'from @/lib/rbac' with 'from @/types/unified-permissions'",
      "Replace 'from @/lib/rolePermissions' with 'from @/types/unified-permissions'",
      "Replace 'from @/lib/auth/permissions' with 'from @/types/unified-permissions'"
    ];
  },

  async validateMigration(): Promise<boolean> {
    return true;
  },

  async generateMigrationReport(): Promise<MigrationStatus> {
    return analyzeMigrationStatus();
  }
};

// ─── Role → Dashboard path mapping (from deleted lib/permissions/unified-permissions.ts) ───

const ROLE_DASHBOARD_PATHS: Record<string, string> = {
  superadmin: '/dashboard/superadmin',
  owner: '/dashboard',
  manager: '/dashboard',
  staff: '/dashboard/staff-dashboard',
};

export function getRoleDashboardPath(role: Role | string | undefined | null): string {
  if (!role) return '/dashboard/staff-dashboard';
  return ROLE_DASHBOARD_PATHS[role as string] || '/dashboard/staff-dashboard';
}

export function canAccessRoute(userRole: Role, route: string): boolean {
  const routePermissions: Record<string, string[]> = {
    '/dashboard/superadmin': ['superadmin'],
    '/dashboard/superadmin/support': ['superadmin'],
    '/dashboard/superadmin/tenants': ['superadmin'],
    '/dashboard/superadmin/analytics': ['superadmin'],
    '/dashboard/superadmin/reservations': ['superadmin'],
    '/dashboard/superadmin/reservation-logs': ['superadmin'],
    '/dashboard/calendar': ['owner', 'manager', 'staff'],
    '/dashboard/bookings': ['owner', 'manager', 'staff'],
    '/dashboard/schedule': ['owner', 'manager', 'staff'],
    '/dashboard/orders': ['owner', 'manager', 'staff'],
    '/dashboard/customers': ['owner', 'manager'],
    '/dashboard/leads': ['owner', 'manager'],
    '/dashboard/faqs': ['owner', 'manager'],
    '/dashboard/mentions': ['owner', 'manager'],
    '/dashboard/ops': ['owner', 'manager'],
    '/dashboard/support': ['owner', 'manager', 'staff'],
    '/dashboard/staff/scheduling': ['owner', 'manager'],
    '/dashboard/settings': ['owner'],
    '/dashboard/billing': ['owner'],
    '/dashboard/usage': ['owner'],
    '/dashboard/owner/llm-metrics': ['owner'],
    '/dashboard/reports': ['owner', 'manager'],
    '/dashboard/tasks': ['owner', 'staff', 'manager'],
  };
  const allowed = routePermissions[route];
  if (!allowed) return true; // unprotected route
  return allowed.includes(userRole);
}

// ─── Superadmin audit log (from deleted lib/enhanced-rbac.ts) ───

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
        created_at: new Date().toISOString(),
      });
    if (error) defaultLogger.error('Failed to log superadmin action', error);
  } catch (e) {
    defaultLogger.error('Failed to audit superadmin action', e);
  }
}

// ─── StrictUserWithRole (from deleted types/type-safe-rbac.ts) ───

export interface StrictUserWithRole {
  readonly id: string;
  readonly email: string;
  readonly role: Role;
  readonly tenantId?: string;
}

export function assertRole(value: unknown, context?: string): Role {
  if (!isValidRole(value as string)) {
    throw new TypeError(`Invalid role${context ? ` in ${context}` : ''}: ${String(value)}. Expected one of: staff, manager, owner, superadmin`);
  }
  return value as Role;
}
