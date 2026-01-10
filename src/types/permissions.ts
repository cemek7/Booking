/**
 * Permission Type Definitions
 * 
 * Hierarchical permission system with granular access control
 * for role-based functionality across the booking system.
 */

import { Role, getInheritedRoles } from './index';

// Permission categories
export type PermissionCategory = 
  | 'system'
  | 'tenant'
  | 'user'
  | 'booking'
  | 'analytics'
  | 'billing'
  | 'messaging'
  | 'reporting'
  | 'api';

// Permission actions
export type PermissionAction = 
  | 'create'
  | 'read'
  | 'update'
  | 'delete'
  | 'manage'
  | 'view'
  | 'execute';

// Permission scope
export type PermissionScope = 
  | 'global'
  | 'tenant'
  | 'team'
  | 'own'
  | 'none';

// Base permission interface
export interface Permission {
  id: string;
  category: PermissionCategory;
  action: PermissionAction;
  scope: PermissionScope;
  description: string;
  resource?: string;
  conditions?: PermissionCondition[];
}

// Permission conditions for contextual access
export interface PermissionCondition {
  type: 'time' | 'location' | 'data' | 'user' | 'tenant';
  operator: 'equals' | 'contains' | 'greater' | 'less' | 'in' | 'not_in';
  value: any;
  description: string;
}

// Role permission mapping
export interface RolePermissions {
  role: Role; // Updated to use standardized Role type
  permissions: Permission[];
  inheritedFrom?: Role[];
  restrictions?: PermissionRestriction[];
}

// Permission restrictions
export interface PermissionRestriction {
  permissionId: string;
  restrictionType: 'time' | 'data' | 'feature' | 'rate';
  description: string;
  config: Record<string, any>;
}

// Permission check result
export interface PermissionCheckResult {
  granted: boolean;
  permission: Permission;
  reason?: string;
  restrictions?: PermissionRestriction[];
  context?: Record<string, any>;
}

// System-wide permission registry
export interface PermissionRegistry {
  [key: string]: Permission;
}

// Permission constants
export const PERMISSIONS: PermissionRegistry = {
  // System permissions
  'system:manage:all': {
    id: 'system:manage:all',
    category: 'system',
    action: 'manage',
    scope: 'global',
    description: 'Full system administration access'
  },
  'system:view:health': {
    id: 'system:view:health',
    category: 'system',
    action: 'view',
    scope: 'global',
    description: 'View system health and status'
  },
  'system:manage:settings': {
    id: 'system:manage:settings',
    category: 'system',
    action: 'manage',
    scope: 'global',
    description: 'Manage global system settings'
  },

  // Tenant permissions
  'tenant:manage:all': {
    id: 'tenant:manage:all',
    category: 'tenant',
    action: 'manage',
    scope: 'tenant',
    description: 'Full tenant administration'
  },
  'tenant:create': {
    id: 'tenant:create',
    category: 'tenant',
    action: 'create',
    scope: 'global',
    description: 'Create new tenants'
  },
  'tenant:view:settings': {
    id: 'tenant:view:settings',
    category: 'tenant',
    action: 'view',
    scope: 'tenant',
    description: 'View tenant settings'
  },
  'tenant:update:settings': {
    id: 'tenant:update:settings',
    category: 'tenant',
    action: 'update',
    scope: 'tenant',
    description: 'Update tenant settings'
  },

  // User management permissions
  'user:manage:all': {
    id: 'user:manage:all',
    category: 'user',
    action: 'manage',
    scope: 'tenant',
    description: 'Manage all users within tenant'
  },
  'user:create': {
    id: 'user:create',
    category: 'user',
    action: 'create',
    scope: 'tenant',
    description: 'Create new users'
  },
  'user:view:profiles': {
    id: 'user:view:profiles',
    category: 'user',
    action: 'view',
    scope: 'tenant',
    description: 'View user profiles'
  },
  'user:update:own': {
    id: 'user:update:own',
    category: 'user',
    action: 'update',
    scope: 'own',
    description: 'Update own profile'
  },
  'user:view:own': {
    id: 'user:view:own',
    category: 'user',
    action: 'view',
    scope: 'own',
    description: 'View own profile'
  },

  // Booking permissions
  'booking:manage:all': {
    id: 'booking:manage:all',
    category: 'booking',
    action: 'manage',
    scope: 'tenant',
    description: 'Manage all bookings within tenant'
  },
  'booking:create': {
    id: 'booking:create',
    category: 'booking',
    action: 'create',
    scope: 'tenant',
    description: 'Create new bookings'
  },
  'booking:view:all': {
    id: 'booking:view:all',
    category: 'booking',
    action: 'view',
    scope: 'tenant',
    description: 'View all bookings within tenant'
  },
  'booking:view:assigned': {
    id: 'booking:view:assigned',
    category: 'booking',
    action: 'view',
    scope: 'team',
    description: 'View assigned/managed bookings'
  },
  'booking:view:own': {
    id: 'booking:view:own',
    category: 'booking',
    action: 'view',
    scope: 'own',
    description: 'View own bookings/schedule'
  },
  'booking:update:all': {
    id: 'booking:update:all',
    category: 'booking',
    action: 'update',
    scope: 'tenant',
    description: 'Update any booking'
  },
  'booking:delete': {
    id: 'booking:delete',
    category: 'booking',
    action: 'delete',
    scope: 'tenant',
    description: 'Cancel/delete bookings'
  },

  // Analytics permissions
  'analytics:view:global': {
    id: 'analytics:view:global',
    category: 'analytics',
    action: 'view',
    scope: 'global',
    description: 'View global analytics across all tenants'
  },
  'analytics:view:tenant': {
    id: 'analytics:view:tenant',
    category: 'analytics',
    action: 'view',
    scope: 'tenant',
    description: 'View tenant-specific analytics'
  },
  'analytics:view:team': {
    id: 'analytics:view:team',
    category: 'analytics',
    action: 'view',
    scope: 'team',
    description: 'View team performance analytics'
  },
  'analytics:view:own': {
    id: 'analytics:view:own',
    category: 'analytics',
    action: 'view',
    scope: 'own',
    description: 'View personal performance analytics'
  },

  // Billing permissions
  'billing:manage:all': {
    id: 'billing:manage:all',
    category: 'billing',
    action: 'manage',
    scope: 'tenant',
    description: 'Manage billing and payments'
  },
  'billing:view:invoices': {
    id: 'billing:view:invoices',
    category: 'billing',
    action: 'view',
    scope: 'tenant',
    description: 'View billing invoices and history'
  },
  'billing:create:charges': {
    id: 'billing:create:charges',
    category: 'billing',
    action: 'create',
    scope: 'tenant',
    description: 'Create billing charges'
  },

  // Messaging permissions
  'messaging:send:whatsapp': {
    id: 'messaging:send:whatsapp',
    category: 'messaging',
    action: 'execute',
    scope: 'tenant',
    description: 'Send WhatsApp messages'
  },
  'messaging:view:conversations': {
    id: 'messaging:view:conversations',
    category: 'messaging',
    action: 'view',
    scope: 'tenant',
    description: 'View messaging conversations'
  },
  'messaging:manage:templates': {
    id: 'messaging:manage:templates',
    category: 'messaging',
    action: 'manage',
    scope: 'tenant',
    description: 'Manage message templates'
  },

  // API permissions
  'api:access:full': {
    id: 'api:access:full',
    category: 'api',
    action: 'execute',
    scope: 'tenant',
    description: 'Full API access for tenant'
  },
  'api:access:readonly': {
    id: 'api:access:readonly',
    category: 'api',
    action: 'read',
    scope: 'tenant',
    description: 'Read-only API access'
  }
};

// Role permission mappings
export const ROLE_PERMISSION_MAP: Record<Role, string[]> = {
  superadmin: [
    'system:manage:all',
    'system:view:health',
    'system:manage:settings',
    'tenant:create',
    'tenant:manage:all',
    'user:manage:all',
    'booking:manage:all',
    'analytics:view:global',
    'billing:manage:all',
    'messaging:send:whatsapp',
    'messaging:view:conversations',
    'messaging:manage:templates',
    'api:access:full'
  ],
  owner: [
    'tenant:view:settings',
    'tenant:update:settings',
    'user:manage:all',
    'user:create',
    'user:view:profiles',
    'booking:manage:all',
    'booking:create',
    'booking:view:all',
    'booking:update:all',
    'booking:delete',
    'analytics:view:tenant',
    'billing:manage:all',
    'billing:view:invoices',
    'billing:create:charges',
    'messaging:send:whatsapp',
    'messaging:view:conversations',
    'messaging:manage:templates',
    'api:access:full'
  ],
  manager: [
    'user:view:profiles',
    'booking:create',
    'booking:view:all',
    'booking:view:assigned',
    'booking:update:all',
    'analytics:view:team',
    'analytics:view:tenant',
    'messaging:send:whatsapp',
    'messaging:view:conversations',
    'api:access:readonly'
  ],
  staff: [
    'user:view:own',
    'user:update:own',
    'booking:view:own',
    'analytics:view:own'
  ]
};

// Permission utility functions - ENHANCED WITH BETTER INHERITANCE
export function hasPermission(
  userRole: Role, // Updated to use standardized Role type
  permissionId: string,
  context?: Record<string, any>
): PermissionCheckResult {
  // Import enhanced permission checking for better inheritance
  try {
    const { hasEnhancedPermission } = require('./enhanced-permissions');
    return hasEnhancedPermission(userRole, permissionId, context);
  } catch (error) {
    // Fallback to original implementation if enhanced module not available
    console.warn('Enhanced permissions not available, using fallback');
    return hasPermissionFallback(userRole, permissionId, context);
  }
}

// Original implementation as fallback
function hasPermissionFallback(
  userRole: Role,
  permissionId: string,
  context?: Record<string, any>
): PermissionCheckResult {
  // Check direct permissions
  const rolePermissions = ROLE_PERMISSION_MAP[userRole] || [];
  let hasDirectAccess = rolePermissions.includes(permissionId);
  
  // Check inherited permissions if no direct access
  if (!hasDirectAccess) {
    const inheritedRoles = getInheritedRoles(userRole);
    hasDirectAccess = inheritedRoles.some(inheritedRole => {
      const inheritedPermissions = ROLE_PERMISSION_MAP[inheritedRole] || [];
      return inheritedPermissions.includes(permissionId);
    });
  }
  
  const permission = PERMISSIONS[permissionId];

  if (!permission) {
    return {
      granted: false,
      permission: permission,
      reason: 'Permission not found'
    };
  }

  return {
    granted: hasDirectAccess,
    permission,
    reason: hasDirectAccess ? undefined : 'Insufficient permissions',
    context
  };
}

export function checkPermissions(
  userRole: Role, // Updated to use standardized Role type
  requiredPermissions: string[],
  context?: Record<string, any>
): PermissionCheckResult[] {
  return requiredPermissions.map(permissionId => 
    hasPermission(userRole, permissionId, context)
  );
}

export function hasAllPermissions(
  userRole: Role, // Updated to use standardized Role type
  requiredPermissions: string[],
  context?: Record<string, any>
): boolean {
  const results = checkPermissions(userRole, requiredPermissions, context);
  return results.every(result => result.granted);
}

export function hasAnyPermission(
  userRole: Role, // Updated to use standardized Role type
  requiredPermissions: string[],
  context?: Record<string, any>
): boolean {
  const results = checkPermissions(userRole, requiredPermissions, context);
  return results.some(result => result.granted);
}

export function getPermissionsForRole(role: Role): Permission[] {
  try {
    const { getAllPermissionsForRole } = require('./enhanced-permissions');
    const permissionIds = getAllPermissionsForRole(role);
    return permissionIds.map((id: string) => PERMISSIONS[id]).filter(Boolean); // Explicitly typed `id`
  } catch (error) {
    // Fallback to original implementation
    console.warn('Enhanced permissions not available, using fallback for getPermissionsForRole');
    return getPermissionsForRoleFallback(role);
  }
}

// Original implementation as fallback
function getPermissionsForRoleFallback(role: Role): Permission[] {
  // Get direct permissions
  const directPermissionIds = ROLE_PERMISSION_MAP[role] || [];
  let allPermissionIds = [...directPermissionIds];
  
  // Add inherited permissions
  const inheritedRoles = getInheritedRoles(role);
  inheritedRoles.forEach(inheritedRole => {
    const inheritedPermissionIds = ROLE_PERMISSION_MAP[inheritedRole] || [];
    allPermissionIds = [...allPermissionIds, ...inheritedPermissionIds];
  });
  
  // Remove duplicates and map to Permission objects
  const uniquePermissionIds = [...new Set(allPermissionIds)];
  return uniquePermissionIds.map(id => PERMISSIONS[id]).filter(Boolean);
}

export function canAccessResource(
  userRole: Role, // Updated to use standardized Role type
  resource: string,
  action: PermissionAction,
  scope: PermissionScope = 'tenant'
): boolean {
  const userPermissions = getPermissionsForRole(userRole);
  
  return userPermissions.some(permission => {
    // Check if permission matches the required action and scope
    if (permission.action === action && permission.scope === scope) {
      // If resource is specified, check if permission covers it
      if (permission.resource) {
        return permission.resource === resource;
      }
      // If no specific resource, permission applies to all resources of the category
      return true;
    }
    
    // Check for manage permissions (manage includes all actions)
    if (permission.action === 'manage' && permission.scope === scope) {
      return true;
    }
    
    return false;
  });
}

// Export all types and utilities
// Note: Type aliases are already exported at declaration