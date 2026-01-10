import { Role } from '@/types';

/**
 * @deprecated Use @/types for new code.
 * 
 * Legacy Unified Permission System for Booka Platform
 * This is kept for backward compatibility only.
 */

export type Permission = 'read' | 'write' | 'admin';
export type ResourceScope = 'global' | 'tenant' | 'team' | 'personal';

export interface RolePermission {
  resource: string;
  permission: Permission;
  scope: ResourceScope;
  conditions?: Record<string, unknown>;
}

export interface RoleConfig {
  role: Role;
  displayName: string;
  dashboardPath: string;
  permissions: RolePermission[];
  analyticsLevel: 'none' | 'personal' | 'team' | 'tenant' | 'system';
  features: string[];
  restrictions: string[];
}

/**
 * Consolidated role configurations with proper isolation
 */
export const UNIFIED_ROLE_CONFIG: Record<Role, RoleConfig> = {
  superadmin: {
    role: 'superadmin',
    displayName: 'System Administrator', 
    dashboardPath: '/superadmin',
    permissions: [
      { resource: '*', permission: 'admin', scope: 'global' }
    ],
    analyticsLevel: 'system',
    features: ['global_analytics', 'tenant_management', 'system_settings', 'user_management'],
    restrictions: []
  },

  owner: {
    role: 'owner',
    displayName: 'Business Owner',
    dashboardPath: '/dashboard/owner', 
    permissions: [
      { resource: 'bookings', permission: 'admin', scope: 'tenant' },
      { resource: 'staff', permission: 'admin', scope: 'tenant' },
      { resource: 'analytics', permission: 'read', scope: 'tenant' },
      { resource: 'settings', permission: 'admin', scope: 'tenant' },
      { resource: 'billing', permission: 'admin', scope: 'tenant' },
      { resource: 'reports', permission: 'admin', scope: 'tenant' }
    ],
    analyticsLevel: 'tenant',
    features: ['full_analytics', 'staff_management', 'billing', 'settings'],
    restrictions: ['global_settings', 'system_analytics']
  },

  manager: {
    role: 'manager', 
    displayName: 'Operations Manager',
    dashboardPath: '/dashboard/manager',
    permissions: [
      { resource: 'bookings', permission: 'write', scope: 'tenant' },
      { resource: 'staff', permission: 'write', scope: 'team' },
      { resource: 'analytics', permission: 'read', scope: 'team' },
      { resource: 'schedules', permission: 'write', scope: 'team' },
      { resource: 'reports', permission: 'read', scope: 'team' }
    ],
    analyticsLevel: 'team',
    features: ['team_analytics', 'staff_scheduling', 'operational_reports'],
    restrictions: ['billing', 'tenant_settings', 'revenue_analytics']
  },

  staff: {
    role: 'staff',
    displayName: 'Staff Member',
    dashboardPath: '/dashboard/staff-dashboard',
    permissions: [
      { resource: 'bookings', permission: 'read', scope: 'personal' },
      { resource: 'schedules', permission: 'read', scope: 'personal' },
      { resource: 'tasks', permission: 'write', scope: 'personal' },
      { resource: 'profile', permission: 'write', scope: 'personal' }
    ],
    analyticsLevel: 'personal',
    features: ['personal_analytics', 'task_management', 'schedule_view'],
    restrictions: ['staff_management', 'analytics', 'settings', 'billing', 'reports']
  }
};

/**
 * Gets the dashboard path for a given role.
 * @param role The role of the user.
 * @returns The dashboard path for the role, or a default path.
 */
export function getRoleDashboardPath(role: Role | string | undefined | null): string {
  const userRole = role as Role;
  if (userRole && UNIFIED_ROLE_CONFIG[userRole]) {
    return UNIFIED_ROLE_CONFIG[userRole].dashboardPath;
  }
  // Default path for unknown roles or if role is not provided
  return '/dashboard/staff-dashboard'; 
}

/**
 * Check if user has permission for specific action
 */
export function hasPermission(
  userRole: Role,
  resource: string,
  permission: Permission
): boolean {
  const roleConfig = UNIFIED_ROLE_CONFIG[userRole];
  if (!roleConfig) {
    return false;
  }

  // Superadmin has all permissions
  if (roleConfig.permissions.some(p => p.resource === '*' && p.permission === 'admin')) {
    return true;
  }

  // Check for specific permission
  const matchingPermission = roleConfig.permissions.find(
    p => p.resource === resource || p.resource === '*'
  );

  if (!matchingPermission) {
    return false;
  }

  // Simple permission check (admin > write > read)
  const permissionLevels: Record<Permission, number> = { read: 1, write: 2, admin: 3 };
  return permissionLevels[matchingPermission.permission] >= permissionLevels[permission];
}

/**
 * Get a list of features available for a given role.
 */
export function getFeaturesForRole(userRole: Role): string[] {
  return UNIFIED_ROLE_CONFIG[userRole]?.features || [];
}

/**
 * Get the analytics level for a given role.
 */
export function getAnalyticsLevel(userRole: Role): 'none' | 'personal' | 'team' | 'tenant' | 'system' {
    return UNIFIED_ROLE_CONFIG[userRole]?.analyticsLevel || 'none';
}

/**
 * Validate route access for role
 */
export function canAccessRoute(userRole: Role, route: string): boolean {
  const config = UNIFIED_ROLE_CONFIG[userRole];
  if (!config) return false;

  // Check if user is accessing their own dashboard
  if (route === config.dashboardPath) {
    return true;
  }

  // Check specific route permissions
  const routePermissions: Record<string, Role[]> = {
    '/dashboard/calendar': ['owner', 'manager', 'staff'],
    '/dashboard/bookings': ['owner', 'manager', 'staff'], 
    '/dashboard/staff/scheduling': ['owner', 'manager'],
    '/dashboard/settings': ['owner'],
    '/dashboard/billing': ['owner'],
    '/dashboard/reports': ['owner', 'manager'],
    '/dashboard/tasks': ['staff', 'manager'],
    '/superadmin': ['superadmin'],
    // Deprecated routes - block access
    '/dashboard/analytics': [],
    '/dashboard/analytics/manager': [],
    '/dashboard/analytics/staff': []
  };

  const allowedRoles = routePermissions[route];
  if (allowedRoles === undefined) {
    // Route not defined - allow access to general dashboard routes
    return route.startsWith('/dashboard/');
  }

  return allowedRoles.includes(userRole);
}

/**
 * Get feature flags for role
 */
export function getRoleFeatures(userRole: Role): string[] {
  return UNIFIED_ROLE_CONFIG[userRole]?.features || [];
}

/**
 * Check if role has specific feature access
 */
export function hasFeatureAccess(userRole: Role, feature: string): boolean {
  return getRoleFeatures(userRole).includes(feature);
}

/**
 * Get role restrictions 
 */
export function getRoleRestrictions(userRole: Role): string[] {
  return UNIFIED_ROLE_CONFIG[userRole]?.restrictions || [];
}

/**
 * Validate tenant isolation - ensure user can only access their tenant's data
 */
export function validateTenantAccess(
  userRole: Role, 
  userTenantId: string, 
  requestedTenantId: string
): boolean {
  // Superadmin can access any tenant
  if (userRole === 'superadmin') {
    return true;
  }
  
  // All other roles must match their assigned tenant
  return userTenantId === requestedTenantId;
}