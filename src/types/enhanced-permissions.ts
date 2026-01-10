/**
 * Enhanced Permission Inheritance System
 * 
 * This module provides improved role-based permission inheritance with
 * better hierarchy management, context-aware permissions, and audit capabilities
 */

import { Role, ROLE_PERMISSION_MAP, PermissionCheckResult } from './index';

// Enhanced role hierarchy with explicit levels and inheritance rules
export interface EnhancedRoleHierarchy {
  level: number;
  inherits: Role[];
  excludes?: string[]; // Permissions explicitly denied despite inheritance
  contextRules?: PermissionContextRule[];
}

export interface PermissionContextRule {
  permission: string;
  condition: 'tenant_match' | 'self_only' | 'team_only' | 'same_level_only';
  description: string;
}

// Enhanced role hierarchy with better inheritance rules
export const ENHANCED_ROLE_HIERARCHY: Record<Role, EnhancedRoleHierarchy> = {
  superadmin: {
    level: 0,
    inherits: ['owner', 'manager', 'staff'],
    contextRules: [
      {
        permission: 'system:manage:all',
        condition: 'same_level_only',
        description: 'Only superadmins can manage other superadmins'
      }
    ]
  },
  owner: {
    level: 1,
    inherits: ['manager', 'staff'],
    excludes: ['system:manage:all', 'system:view:health'], // Owners can't access global system functions
    contextRules: [
      {
        permission: 'tenant:manage:all',
        condition: 'tenant_match',
        description: 'Owners can only manage their own tenant'
      },
      {
        permission: 'user:manage:all',
        condition: 'tenant_match',
        description: 'Owners can only manage users within their tenant'
      }
    ]
  },
  manager: {
    level: 2,
    inherits: ['staff'],
    excludes: ['tenant:manage:all', 'billing:manage:all'], // Managers can't access tenant-level settings
    contextRules: [
      {
        permission: 'booking:update:all',
        condition: 'tenant_match',
        description: 'Managers can only update bookings in their tenant'
      },
      {
        permission: 'analytics:view:team',
        condition: 'team_only',
        description: 'Managers can only view analytics for their team'
      }
    ]
  },
  staff: {
    level: 3,
    inherits: [],
    contextRules: [
      {
        permission: 'user:update:own',
        condition: 'self_only',
        description: 'Staff can only update their own profile'
      },
      {
        permission: 'booking:view:own',
        condition: 'self_only',
        description: 'Staff can only view their own bookings'
      }
    ]
  }
};

// Enhanced permission context for better access control
export interface EnhancedPermissionContext {
  tenantId?: string;
  userId?: string;
  targetUserId?: string;
  targetTenantId?: string;
  resourceOwnerId?: string;
  teamId?: string;
  [key: string]: any;
}

// Enhanced permission checking with improved inheritance
export function hasEnhancedPermission(
  userRole: Role,
  permissionId: string,
  context?: EnhancedPermissionContext
): PermissionCheckResult {
  const roleHierarchy = ENHANCED_ROLE_HIERARCHY[userRole];
  
  // Check if permission is explicitly excluded for this role
  if (roleHierarchy.excludes?.includes(permissionId)) {
    return {
      granted: false,
      reason: `Permission ${permissionId} is explicitly denied for role ${userRole}`
    };
  }

  // Get all permissions including inherited ones
  const allPermissions = getAllPermissionsForRole(userRole);
  
  if (!allPermissions.includes(permissionId)) {
    return {
      granted: false,
      reason: 'Permission not available for this role'
    };
  }

  // Check context-specific rules
  const contextRule = roleHierarchy.contextRules?.find(rule => rule.permission === permissionId);
  if (contextRule && context) {
    const contextCheck = checkPermissionContext(contextRule, context);
    if (!contextCheck.allowed) {
      return {
        granted: false,
        reason: contextCheck.reason
      };
    }
  }

  return {
    granted: true,
    context
  };
}
export function getAllPermissionsForRole(role: Role): string[] {
  const hierarchy = ENHANCED_ROLE_HIERARCHY[role];
  let allPermissions: string[] = [];

  // Add direct permissions
  const directPermissions = ROLE_PERMISSION_MAP[role] || [];
  allPermissions = [...directPermissions];

  // Add inherited permissions recursively
  hierarchy.inherits.forEach(inheritedRole => {
    const inheritedPermissions = getAllPermissionsForRole(inheritedRole);
    allPermissions = [...allPermissions, ...inheritedPermissions];
  });

  // Remove excluded permissions
  if (hierarchy.excludes) {
    allPermissions = allPermissions.filter(permission => !hierarchy.excludes!.includes(permission));
  }

  // Remove duplicates
  return [...new Set(allPermissions)];
}

// Check if a user can perform an action on a specific resource
export function canAccessResourceWithContext(
  userRole: Role,
  permissionId: string,
  context: EnhancedPermissionContext
): PermissionCheckResult {
  // First check if the user has the permission
  const permissionCheck = hasEnhancedPermission(userRole, permissionId, context);
  
  if (!permissionCheck.granted) {
    return permissionCheck;
  }

  // Additional context-based validation
  if (context.targetUserId && context.userId) {
    // Check if user is trying to access their own resource
    const isOwnResource = context.targetUserId === context.userId;
    
    // Staff can only access their own resources unless they have broader permissions
    if (userRole === 'staff' && !isOwnResource && !permissionId.includes(':all')) {
      return {
        granted: false,
        reason: 'Staff can only access their own resources'
      };
    }
  }

  if (context.targetTenantId && context.tenantId) {
    // Check tenant isolation
    const isSameTenant = context.targetTenantId === context.tenantId;
    
    // Only superadmins can access cross-tenant resources
    if (!isSameTenant && userRole !== 'superadmin') {
      return {
        granted: false,
        reason: 'Cannot access resources from different tenants'
      };
    }
  }

  return {
    granted: true,
    context
  };
}

// Check context-specific rules
function checkPermissionContext(
  rule: PermissionContextRule,
  context: EnhancedPermissionContext
): { allowed: boolean; reason?: string } {
  switch (rule.condition) {
    case 'self_only':
      if (context.targetUserId && context.userId) {
        return {
          allowed: context.targetUserId === context.userId,
          reason: context.targetUserId !== context.userId ? 'Can only access own resources' : undefined
        };
      }
      return { allowed: true };

    case 'tenant_match':
      if (context.targetTenantId && context.tenantId) {
        return {
          allowed: context.targetTenantId === context.tenantId,
          reason: context.targetTenantId !== context.tenantId ? 'Can only access resources within same tenant' : undefined
        };
      }
      return { allowed: true };

    case 'team_only':
      if (context.teamId && context.targetUserId) {
        // This would need additional logic to check if target user is in the same team
        // For now, allow if both are in same tenant
        return {
          allowed: context.tenantId === context.targetTenantId,
          reason: 'Can only access team resources'
        };
      }
      return { allowed: true };

    case 'same_level_only':
      // This would need user role comparison logic
      return { allowed: true };

    default:
      return { allowed: true };
  }
}

// Get role hierarchy level
export function getRoleLevel(role: Role): number {
  return ENHANCED_ROLE_HIERARCHY[role].level;
}

// Check if one role is higher than another in hierarchy
export function isHigherRole(role1: Role, role2: Role): boolean {
  return getRoleLevel(role1) < getRoleLevel(role2);
}

// Get effective permissions for a role (direct + inherited - excluded)
export function getEffectivePermissions(role: Role): {
  direct: string[];
  inherited: string[];
  excluded: string[];
  effective: string[];
} {
  const hierarchy = ENHANCED_ROLE_HIERARCHY[role];
  const direct = ROLE_PERMISSION_MAP[role] || [];
  
  let inherited: string[] = [];
  hierarchy.inherits.forEach(inheritedRole => {
    const inheritedPerms = getAllPermissionsForRole(inheritedRole);
    inherited = [...inherited, ...inheritedPerms];
  });
  inherited = [...new Set(inherited)]; // Remove duplicates

  const excluded = hierarchy.excludes || [];
  const effective = getAllPermissionsForRole(role);

  return {
    direct,
    inherited,
    excluded,
    effective
  };
}

// Audit function to check permission inheritance issues
export function auditRolePermissions(role: Role): {
  role: Role;
  issues: string[];
  recommendations: string[];
  permissions: ReturnType<typeof getEffectivePermissions>;
} {
  const permissions = getEffectivePermissions(role);
  const issues: string[] = [];
  const recommendations: string[] = [];

  // Check for potential issues
  if (permissions.direct.length === 0 && role !== 'staff') {
    issues.push(`Role ${role} has no direct permissions defined`);
  }

  if (permissions.excluded.length > permissions.inherited.length * 0.5) {
    issues.push(`Role ${role} excludes more than 50% of inherited permissions - consider restructuring`);
  }

  // Check for missing core permissions
  const corePermissions = ['user:view:own', 'user:update:own'];
  corePermissions.forEach(perm => {
    if (!permissions.effective.includes(perm)) {
      issues.push(`Role ${role} missing core permission: ${perm}`);
      recommendations.push(`Add core permission ${perm} to role ${role}`);
    }
  });

  return {
    role,
    issues,
    recommendations,
    permissions
  };
}