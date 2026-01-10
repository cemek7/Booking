/**
 * Permissions Matrix
 * Centralized permission definitions for all roles
 * 
 * Single source of truth for role-to-permission mapping
 * Eliminates scattered permission checks across 57+ routes
 */

import { Role } from './unified-auth-orchestrator';

/**
 * Complete permissions matrix for all roles and resources
 * Format: { role: { resource: [actions] } }
 */
export const PERMISSIONS_MATRIX: Record<Role, Record<string, string[]>> = {
  superadmin: {
    // Full access to everything
    '*': ['*'],
    'dashboard': ['read', 'write', 'delete', 'manage'],
    'users': ['read', 'write', 'delete', 'manage', 'impersonate'],
    'tenants': ['read', 'write', 'delete', 'manage', 'create'],
    'staff': ['read', 'write', 'delete', 'manage'],
    'services': ['read', 'write', 'delete', 'manage'],
    'reservations': ['read', 'write', 'delete', 'manage', 'refund'],
    'payments': ['read', 'write', 'delete', 'manage', 'refund'],
    'reports': ['read', 'write', 'delete', 'manage'],
    'analytics': ['read', 'write', 'delete', 'manage'],
    'settings': ['read', 'write', 'delete', 'manage'],
    'audit': ['read', 'write', 'manage'],
    'roles': ['read', 'write', 'delete', 'manage'],
    'permissions': ['read', 'write', 'delete', 'manage'],
    'billing': ['read', 'write', 'delete', 'manage'],
    'integrations': ['read', 'write', 'delete', 'manage'],
    'webhooks': ['read', 'write', 'delete', 'manage'],
    'api_keys': ['read', 'write', 'delete', 'manage', 'create'],
    'logs': ['read', 'write', 'delete', 'export'],
  },

  owner: {
    // Full access to own tenant
    'dashboard': ['read', 'write'],
    'tenant': ['read', 'write', 'manage'],
    'users': ['read', 'write', 'delete', 'invite'],
    'staff': ['read', 'write', 'delete', 'invite', 'manage'],
    'staff:status': ['read', 'write', 'manage'],
    'staff:attributes': ['read', 'write', 'manage'],
    'staff:skills': ['read', 'write', 'manage'],
    'services': ['read', 'write', 'delete', 'create'],
    'services:settings': ['read', 'write', 'manage'],
    'reservations': ['read', 'write', 'delete', 'manage'],
    'reservations:approve': ['read', 'write'],
    'reservations:refund': ['read', 'write'],
    'payments': ['read', 'write', 'refund'],
    'reports': ['read', 'export'],
    'analytics': ['read', 'export'],
    'settings': ['read', 'write'],
    'audit': ['read'],
    'billing': ['read', 'write', 'manage'],
    'integrations': ['read', 'write', 'manage'],
    'webhooks': ['read', 'write', 'create', 'manage'],
    'api_keys': ['read', 'write', 'create', 'delete'],
    'invitations': ['read', 'write', 'delete', 'create'],
  },

  manager: {
    // Can manage operations but not settings
    'dashboard': ['read'],
    'users': ['read', 'write'],
    'staff': ['read', 'write', 'manage'],
    'staff:status': ['read', 'write'],
    'staff:attributes': ['read', 'write'],
    'staff:skills': ['read', 'write'],
    'services': ['read', 'write', 'manage'],
    'services:settings': ['read', 'write'],
    'reservations': ['read', 'write', 'manage'],
    'reservations:approve': ['read', 'write'],
    'reservations:refund': ['read'],
    'payments': ['read', 'write'],
    'reports': ['read', 'export'],
    'analytics': ['read'],
    'audit': ['read'],
    'scheduling': ['read', 'write', 'manage'],
    'scheduler:find_slot': ['read', 'write'],
    'scheduler:find_staff': ['read', 'write'],
  },

  staff: {
    // Can manage own schedule and view shared data
    'dashboard': ['read'],
    'profile': ['read', 'write'],
    'schedule': ['read', 'write', 'manage_own'],
    'reservations': ['read'],
    'reservations:own': ['read', 'write'],
    'staff:attributes': ['read'],
    'staff:skills': ['read'],
    'services': ['read'],
    'analytics': ['read'],
    'scheduling': ['read', 'write'],
    'scheduler:find_slot': ['read'],
    'scheduler:find_staff': ['read'],
  },

  customer: {
    // Can view and manage own bookings
    'profile': ['read', 'write'],
    'reservations': ['read'],
    'reservations:own': ['read', 'write', 'cancel'],
    'services': ['read'],
    'availability': ['read'],
    'public_calendar': ['read'],
  },

  guest: {
    // Read-only public access
    'services': ['read'],
    'availability': ['read'],
    'public_calendar': ['read'],
    'public_info': ['read'],
  },
};

/**
 * Check if a role has a specific permission for a resource
 * @param role - User's role
 * @param resource - Resource name (e.g., 'staff', 'reservations')
 * @param action - Action name (e.g., 'read', 'write', 'delete')
 * @returns true if role has permission
 */
export function hasPermission(
  role: Role | null | undefined,
  resource: string,
  action: string
): boolean {
  if (!role) return false;
  if (role === 'superadmin') return true; // Superadmin has all permissions

  const rolePermissions = PERMISSIONS_MATRIX[role];
  if (!rolePermissions) return false;

  // Check wildcard permission
  if (rolePermissions['*']?.includes('*')) return true;
  if (rolePermissions['*']?.includes(action)) return true;

  // Check specific resource permissions
  const resourcePermissions = rolePermissions[resource];
  if (!resourcePermissions) return false;

  return resourcePermissions.includes('*') || resourcePermissions.includes(action);
}

/**
 * Check if a role has any of the required permissions
 * @param role - User's role
 * @param resource - Resource name
 * @param actions - Array of required action names (any one is sufficient)
 * @returns true if role has at least one of the actions
 */
export function hasAnyPermission(
  role: Role | null | undefined,
  resource: string,
  actions: string[]
): boolean {
  if (!role) return false;
  if (role === 'superadmin') return true;

  return actions.some((action) => hasPermission(role, resource, action));
}

/**
 * Check if a role has all required permissions
 * @param role - User's role
 * @param resource - Resource name
 * @param actions - Array of required action names (all are required)
 * @returns true if role has all actions
 */
export function hasAllPermissions(
  role: Role | null | undefined,
  resource: string,
  actions: string[]
): boolean {
  if (!role) return false;
  if (role === 'superadmin') return true;

  return actions.every((action) => hasPermission(role, resource, action));
}

/**
 * Get all permissions for a role
 * @param role - User's role
 * @returns Object mapping resources to available actions
 */
export function getPermissionsForRole(role: Role | null | undefined): Record<string, string[]> {
  if (!role) return {};
  if (role === 'superadmin') {
    // Return full matrix for superadmin
    const allPermissions: Record<string, string[]> = {};
    Object.values(PERMISSIONS_MATRIX).forEach((rolePerms) => {
      Object.entries(rolePerms).forEach(([resource, actions]) => {
        allPermissions[resource] = actions;
      });
    });
    return allPermissions;
  }

  return PERMISSIONS_MATRIX[role] || {};
}

/**
 * Get list of resources a role can access for a specific action
 * @param role - User's role
 * @param action - Action name (e.g., 'write', 'delete')
 * @returns Array of accessible resources
 */
export function getAccessibleResources(role: Role | null | undefined, action: string): string[] {
  if (!role) return [];
  if (role === 'superadmin') {
    return Object.keys(PERMISSIONS_MATRIX['superadmin']);
  }

  const rolePermissions = PERMISSIONS_MATRIX[role];
  if (!rolePermissions) return [];

  return Object.entries(rolePermissions)
    .filter(([_, actions]) => actions.includes('*') || actions.includes(action))
    .map(([resource]) => resource);
}

/**
 * Check if a role can perform action on another role
 * (Based on role hierarchy - you can't elevate someone above your level)
 * @param actingRole - Role trying to perform action
 * @param targetRole - Role being acted upon
 * @returns true if acting role can act on target role
 */
export function canActOnRole(actingRole: Role | null | undefined, targetRole: Role): boolean {
  if (!actingRole) return false;
  if (actingRole === 'superadmin') return true;

  const roleOrder: Record<Role, number> = {
    superadmin: 5,
    owner: 4,
    manager: 3,
    staff: 2,
    customer: 1,
    guest: 0,
  };

  return roleOrder[actingRole] > roleOrder[targetRole];
}

/**
 * Get required roles to perform an action on a resource
 * @param resource - Resource name
 * @param action - Action name
 * @returns Array of roles that can perform this action
 */
export function getRequiredRoles(resource: string, action: string): Role[] {
  const roles: Role[] = [];

  Object.entries(PERMISSIONS_MATRIX).forEach(([role, permissions]) => {
    const resourcePerms = permissions[resource];
    if (
      resourcePerms &&
      (resourcePerms.includes('*') || resourcePerms.includes(action))
    ) {
      roles.push(role as Role);
    }
  });

  return roles;
}

/**
 * Check if two roles have conflicting permissions for a resource
 * (Useful for detecting permission conflicts when merging roles)
 * @param role1 - First role
 * @param role2 - Second role
 * @param resource - Resource to check
 * @returns true if roles have same permissions for resource
 */
export function rolesHaveSamePermissions(role1: Role, role2: Role, resource: string): boolean {
  const perms1 = PERMISSIONS_MATRIX[role1]?.[resource] || [];
  const perms2 = PERMISSIONS_MATRIX[role2]?.[resource] || [];

  if (perms1.length !== perms2.length) return false;

  return perms1.every((perm) => perms2.includes(perm));
}

/**
 * Export permission map for frontend use
 * (Can be sent to client for UI permission-based visibility)
 */
export function getPermissionMap(role: Role | null | undefined): Record<string, boolean> {
  if (!role) return {};

  const permissions = getPermissionsForRole(role);
  const map: Record<string, boolean> = {};

  Object.entries(permissions).forEach(([resource, actions]) => {
    actions.forEach((action) => {
      const key = `${resource}:${action}`;
      map[key] = true;
    });
  });

  return map;
}
