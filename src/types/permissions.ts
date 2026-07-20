/**
 * Permission Type Definitions
 * 
 * Hierarchical permission system with granular access control
 * for role-based functionality across the booking system.
 */

import { defaultLogger } from '@/lib/logger';
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
  value: unknown;
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
  config: Record<string, unknown>;
}

// Permission check result
export interface PermissionCheckResult {
  granted: boolean;
  permission: Permission;
  reason?: string;
  restrictions?: PermissionRestriction[];
  context?: Record<string, unknown>;
}

// System-wide permission registry
export interface PermissionRegistry {
  [key: string]: Permission;
}

export const BOOKA_PERMISSIONS = {
  VIEW_APPOINTMENTS: 'VIEW_APPOINTMENTS',
  MANAGE_APPOINTMENTS: 'MANAGE_APPOINTMENTS',
  COMPLETE_SERVICES: 'COMPLETE_SERVICES',
  VIEW_PRODUCTS: 'VIEW_PRODUCTS',
  MANAGE_PRODUCTS: 'MANAGE_PRODUCTS',
  RECORD_SALES: 'RECORD_SALES',
  ISSUE_DISCOUNTS: 'ISSUE_DISCOUNTS',
  RECORD_PAYMENTS: 'RECORD_PAYMENTS',
  ISSUE_REFUNDS: 'ISSUE_REFUNDS',
  ADJUST_INVENTORY: 'ADJUST_INVENTORY',
  PERFORM_STOCK_COUNTS: 'PERFORM_STOCK_COUNTS',
  VIEW_ANALYTICS: 'VIEW_ANALYTICS',
  VIEW_REVENUE: 'VIEW_REVENUE',
  MANAGE_STAFF: 'MANAGE_STAFF',
  VIEW_CUSTOMER_NOTES: 'VIEW_CUSTOMER_NOTES',
  MERGE_CUSTOMERS: 'MERGE_CUSTOMERS',
  APPROVE_ANOMALIES: 'APPROVE_ANOMALIES',
  APPROVE_LARGE_DISCOUNTS: 'APPROVE_LARGE_DISCOUNTS',
  APPROVE_REFUNDS: 'APPROVE_REFUNDS',
} as const;

type BookaPermissionId = typeof BOOKA_PERMISSIONS[keyof typeof BOOKA_PERMISSIONS];

// Permission constants
export const PERMISSIONS: PermissionRegistry = {
  [BOOKA_PERMISSIONS.VIEW_APPOINTMENTS]: {
    id: BOOKA_PERMISSIONS.VIEW_APPOINTMENTS,
    category: 'booking',
    action: 'view',
    scope: 'tenant',
    description: 'View appointments and booking schedules',
  },
  [BOOKA_PERMISSIONS.MANAGE_APPOINTMENTS]: {
    id: BOOKA_PERMISSIONS.MANAGE_APPOINTMENTS,
    category: 'booking',
    action: 'manage',
    scope: 'tenant',
    description: 'Create, reschedule, and cancel appointments',
  },
  [BOOKA_PERMISSIONS.COMPLETE_SERVICES]: {
    id: BOOKA_PERMISSIONS.COMPLETE_SERVICES,
    category: 'booking',
    action: 'update',
    scope: 'tenant',
    description: 'Mark services and appointments as completed',
  },
  [BOOKA_PERMISSIONS.VIEW_PRODUCTS]: {
    id: BOOKA_PERMISSIONS.VIEW_PRODUCTS,
    category: 'tenant',
    action: 'view',
    scope: 'tenant',
    description: 'View products, inventory, and retail catalogue data',
  },
  [BOOKA_PERMISSIONS.MANAGE_PRODUCTS]: {
    id: BOOKA_PERMISSIONS.MANAGE_PRODUCTS,
    category: 'tenant',
    action: 'manage',
    scope: 'tenant',
    description: 'Create and update products and retail catalogue data',
  },
  [BOOKA_PERMISSIONS.RECORD_SALES]: {
    id: BOOKA_PERMISSIONS.RECORD_SALES,
    category: 'billing',
    action: 'create',
    scope: 'tenant',
    description: 'Record retail sales and completed commerce transactions',
  },
  [BOOKA_PERMISSIONS.ISSUE_DISCOUNTS]: {
    id: BOOKA_PERMISSIONS.ISSUE_DISCOUNTS,
    category: 'billing',
    action: 'manage',
    scope: 'tenant',
    description: 'Apply discounts to services and retail orders',
  },
  [BOOKA_PERMISSIONS.RECORD_PAYMENTS]: {
    id: BOOKA_PERMISSIONS.RECORD_PAYMENTS,
    category: 'billing',
    action: 'create',
    scope: 'tenant',
    description: 'Record inbound payments, deposits, and settlements',
  },
  [BOOKA_PERMISSIONS.ISSUE_REFUNDS]: {
    id: BOOKA_PERMISSIONS.ISSUE_REFUNDS,
    category: 'billing',
    action: 'manage',
    scope: 'tenant',
    description: 'Issue refunds and reverse customer payments',
  },
  [BOOKA_PERMISSIONS.ADJUST_INVENTORY]: {
    id: BOOKA_PERMISSIONS.ADJUST_INVENTORY,
    category: 'tenant',
    action: 'update',
    scope: 'tenant',
    description: 'Adjust live stock levels and inventory movements',
  },
  [BOOKA_PERMISSIONS.PERFORM_STOCK_COUNTS]: {
    id: BOOKA_PERMISSIONS.PERFORM_STOCK_COUNTS,
    category: 'tenant',
    action: 'execute',
    scope: 'tenant',
    description: 'Run stock counts and count-adjustment workflows',
  },
  [BOOKA_PERMISSIONS.VIEW_ANALYTICS]: {
    id: BOOKA_PERMISSIONS.VIEW_ANALYTICS,
    category: 'analytics',
    action: 'view',
    scope: 'tenant',
    description: 'View tenant analytics and operational insights',
  },
  [BOOKA_PERMISSIONS.VIEW_REVENUE]: {
    id: BOOKA_PERMISSIONS.VIEW_REVENUE,
    category: 'reporting',
    action: 'view',
    scope: 'tenant',
    description: 'View revenue assurance, close reports, and financial summaries',
  },
  [BOOKA_PERMISSIONS.MANAGE_STAFF]: {
    id: BOOKA_PERMISSIONS.MANAGE_STAFF,
    category: 'user',
    action: 'manage',
    scope: 'tenant',
    description: 'Manage staff access, permissions, and accountability settings',
  },
  [BOOKA_PERMISSIONS.VIEW_CUSTOMER_NOTES]: {
    id: BOOKA_PERMISSIONS.VIEW_CUSTOMER_NOTES,
    category: 'user',
    action: 'view',
    scope: 'tenant',
    description: 'View sensitive customer notes and internal memory',
  },
  [BOOKA_PERMISSIONS.MERGE_CUSTOMERS]: {
    id: BOOKA_PERMISSIONS.MERGE_CUSTOMERS,
    category: 'user',
    action: 'manage',
    scope: 'tenant',
    description: 'Review duplicate customers and merge customer histories',
  },
  [BOOKA_PERMISSIONS.APPROVE_ANOMALIES]: {
    id: BOOKA_PERMISSIONS.APPROVE_ANOMALIES,
    category: 'reporting',
    action: 'manage',
    scope: 'tenant',
    description: 'Review and resolve business anomalies',
  },
  [BOOKA_PERMISSIONS.APPROVE_LARGE_DISCOUNTS]: {
    id: BOOKA_PERMISSIONS.APPROVE_LARGE_DISCOUNTS,
    category: 'billing',
    action: 'manage',
    scope: 'tenant',
    description: 'Approve discount requests above the normal operator threshold',
  },
  [BOOKA_PERMISSIONS.APPROVE_REFUNDS]: {
    id: BOOKA_PERMISSIONS.APPROVE_REFUNDS,
    category: 'billing',
    action: 'manage',
    scope: 'tenant',
    description: 'Approve refunds that require supervisory sign-off',
  },
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

const BOOKA_OWNER_PERMISSIONS: BookaPermissionId[] = Object.values(BOOKA_PERMISSIONS);
const BOOKA_MANAGER_PERMISSIONS: BookaPermissionId[] = [
  BOOKA_PERMISSIONS.VIEW_APPOINTMENTS,
  BOOKA_PERMISSIONS.MANAGE_APPOINTMENTS,
  BOOKA_PERMISSIONS.COMPLETE_SERVICES,
  BOOKA_PERMISSIONS.VIEW_PRODUCTS,
  BOOKA_PERMISSIONS.MANAGE_PRODUCTS,
  BOOKA_PERMISSIONS.RECORD_SALES,
  BOOKA_PERMISSIONS.ISSUE_DISCOUNTS,
  BOOKA_PERMISSIONS.RECORD_PAYMENTS,
  BOOKA_PERMISSIONS.ISSUE_REFUNDS,
  BOOKA_PERMISSIONS.ADJUST_INVENTORY,
  BOOKA_PERMISSIONS.PERFORM_STOCK_COUNTS,
  BOOKA_PERMISSIONS.VIEW_ANALYTICS,
  BOOKA_PERMISSIONS.VIEW_REVENUE,
  BOOKA_PERMISSIONS.MANAGE_STAFF,
  BOOKA_PERMISSIONS.VIEW_CUSTOMER_NOTES,
  BOOKA_PERMISSIONS.MERGE_CUSTOMERS,
  BOOKA_PERMISSIONS.APPROVE_ANOMALIES,
  BOOKA_PERMISSIONS.APPROVE_LARGE_DISCOUNTS,
  BOOKA_PERMISSIONS.APPROVE_REFUNDS,
];
const BOOKA_STAFF_PERMISSIONS: BookaPermissionId[] = [
  BOOKA_PERMISSIONS.VIEW_APPOINTMENTS,
  BOOKA_PERMISSIONS.MANAGE_APPOINTMENTS,
  BOOKA_PERMISSIONS.COMPLETE_SERVICES,
  BOOKA_PERMISSIONS.VIEW_PRODUCTS,
  BOOKA_PERMISSIONS.RECORD_SALES,
  BOOKA_PERMISSIONS.RECORD_PAYMENTS,
  BOOKA_PERMISSIONS.VIEW_CUSTOMER_NOTES,
];

// Role permission mappings
export const ROLE_PERMISSION_MAP: Record<Role, string[]> = {
  superadmin: [
    ...BOOKA_OWNER_PERMISSIONS,
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
    ...BOOKA_OWNER_PERMISSIONS,
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
    ...BOOKA_MANAGER_PERMISSIONS,
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
    ...BOOKA_STAFF_PERMISSIONS,
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
  context?: Record<string, unknown>
): PermissionCheckResult {
  // Import enhanced permission checking for better inheritance
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { hasEnhancedPermission } = require('./enhanced-permissions');
    return hasEnhancedPermission(userRole, permissionId, context);
  } catch {
    // Fallback to original implementation if enhanced module not available
    defaultLogger.warn('Enhanced permissions not available, using fallback');
    return hasPermissionFallback(userRole, permissionId, context);
  }
}

// Original implementation as fallback
function hasPermissionFallback(
  userRole: Role,
  permissionId: string,
  context?: Record<string, unknown>
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
      permission: {
        id: permissionId,
        category: 'api',
        action: 'read',
        scope: 'none',
        description: 'Unknown permission',
      },
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
  context?: Record<string, unknown>
): PermissionCheckResult[] {
  return requiredPermissions.map(permissionId => 
    hasPermission(userRole, permissionId, context)
  );
}

export function hasAllPermissions(
  userRole: Role, // Updated to use standardized Role type
  requiredPermissions: string[],
  context?: Record<string, unknown>
): boolean {
  const results = checkPermissions(userRole, requiredPermissions, context);
  return results.every(result => result.granted);
}

export function hasAnyPermission(
  userRole: Role, // Updated to use standardized Role type
  requiredPermissions: string[],
  context?: Record<string, unknown>
): boolean {
  const results = checkPermissions(userRole, requiredPermissions, context);
  return results.some(result => result.granted);
}

export function getPermissionsForRole(role: Role): Permission[] {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getAllPermissionsForRole } = require('./enhanced-permissions');
    const permissionIds = getAllPermissionsForRole(role);
    return permissionIds.map((id: string) => PERMISSIONS[id]).filter(Boolean); // Explicitly typed `id`
  } catch {
    // Fallback to original implementation
    defaultLogger.warn('Enhanced permissions not available, using fallback for getPermissionsForRole');
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
