/**
 * Permission System Testing and Validation Utility
 * 
 * This utility helps validate the enhanced permission inheritance system
 * and provides tools for testing role-based access control
 */

import { Role } from './roles';
import { hasPermission, PERMISSIONS } from './permissions';
import { 
  hasEnhancedPermission, 
  getAllPermissionsForRole,
  auditRolePermissions,
  getEffectivePermissions,
  canAccessResourceWithContext,
  EnhancedPermissionContext
} from './enhanced-permissions';

// Test scenarios for permission validation
export interface PermissionTestScenario {
  name: string;
  userRole: Role;
  permission: string;
  context?: EnhancedPermissionContext;
  expectedResult: boolean;
  description: string;
}

// Common test scenarios
export const PERMISSION_TEST_SCENARIOS: PermissionTestScenario[] = [
  // Staff permissions
  {
    name: 'Staff can view own profile',
    userRole: 'staff',
    permission: 'user:view:own',
    context: { userId: 'staff-1', targetUserId: 'staff-1', tenantId: 'tenant-1' },
    expectedResult: true,
    description: 'Staff should be able to view their own profile'
  },
  {
    name: 'Staff cannot view others profile',
    userRole: 'staff',
    permission: 'user:view:profiles',
    expectedResult: false,
    description: 'Staff should not be able to view other user profiles'
  },
  {
    name: 'Staff can view own bookings',
    userRole: 'staff',
    permission: 'booking:view:own',
    expectedResult: true,
    description: 'Staff should be able to view their own bookings'
  },

  // Manager inheritance tests
  {
    name: 'Manager inherits staff view own',
    userRole: 'manager',
    permission: 'user:view:own',
    expectedResult: true,
    description: 'Manager should inherit staff permission to view own profile'
  },
  {
    name: 'Manager can view team profiles',
    userRole: 'manager',
    permission: 'user:view:profiles',
    expectedResult: true,
    description: 'Manager should be able to view user profiles'
  },
  {
    name: 'Manager can view all bookings',
    userRole: 'manager',
    permission: 'booking:view:all',
    expectedResult: true,
    description: 'Manager should be able to view all bookings'
  },
  {
    name: 'Manager cannot manage billing',
    userRole: 'manager',
    permission: 'billing:manage:all',
    expectedResult: false,
    description: 'Manager should not have billing management permissions (excluded)'
  },

  // Owner inheritance tests
  {
    name: 'Owner inherits manager permissions',
    userRole: 'owner',
    permission: 'booking:view:all',
    expectedResult: true,
    description: 'Owner should inherit manager booking permissions'
  },
  {
    name: 'Owner can manage billing',
    userRole: 'owner',
    permission: 'billing:manage:all',
    expectedResult: true,
    description: 'Owner should be able to manage billing'
  },
  {
    name: 'Owner cannot access system management',
    userRole: 'owner',
    permission: 'system:manage:all',
    expectedResult: false,
    description: 'Owner should not have system-wide management permissions (excluded)'
  },

  // Superadmin tests
  {
    name: 'Superadmin can access system management',
    userRole: 'superadmin',
    permission: 'system:manage:all',
    expectedResult: true,
    description: 'Superadmin should have all system permissions'
  },
  {
    name: 'Superadmin inherits all lower permissions',
    userRole: 'superadmin',
    permission: 'booking:view:own',
    expectedResult: true,
    description: 'Superadmin should inherit all permissions from lower roles'
  }
];

// Run permission tests
export function runPermissionTests(): {
  passed: number;
  failed: number;
  results: Array<{
    scenario: PermissionTestScenario;
    passed: boolean;
    actualResult: boolean;
    error?: string;
  }>;
} {
  let passed = 0;
  let failed = 0;
  const results: any[] = [];

  PERMISSION_TEST_SCENARIOS.forEach(scenario => {
    try {
      const result = hasEnhancedPermission(
        scenario.userRole,
        scenario.permission,
        scenario.context
      );

      const actualResult = result.granted;
      const testPassed = actualResult === scenario.expectedResult;

      if (testPassed) {
        passed++;
      } else {
        failed++;
      }

      results.push({
        scenario,
        passed: testPassed,
        actualResult,
        reason: result.reason
      });

    } catch (error) {
      failed++;
      results.push({
        scenario,
        passed: false,
        actualResult: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  return { passed, failed, results };
}

// Audit all roles
export function auditAllRoles(): Record<Role, ReturnType<typeof auditRolePermissions>> {
  const roles: Role[] = ['superadmin', 'owner', 'manager', 'staff'];
  const results: any = {};

  roles.forEach(role => {
    results[role] = auditRolePermissions(role);
  });

  return results;
}

// Compare permission systems (original vs enhanced)
export function comparePermissionSystems(
  role: Role,
  permission: string,
  context?: Record<string, any>
): {
  original: boolean;
  enhanced: boolean;
  match: boolean;
  originalReason?: string;
  enhancedReason?: string;
} {
  // Test original system
  const originalResult = hasPermission(role, permission, context);
  
  // Test enhanced system
  const enhancedResult = hasEnhancedPermission(role, permission, context);

  return {
    original: originalResult.granted,
    enhanced: enhancedResult.granted,
    match: originalResult.granted === enhancedResult.granted,
    originalReason: originalResult.reason,
    enhancedReason: enhancedResult.reason
  };
}

// Get permission summary for role
export function getPermissionSummary(role: Role): {
  role: Role;
  totalPermissions: number;
  effectivePermissions: ReturnType<typeof getEffectivePermissions>;
  samplePermissions: string[];
  hierarchyLevel: number;
} {
  const effectivePermissions = getEffectivePermissions(role);
  const { getRoleLevel } = require('./enhanced-permissions');
  
  return {
    role,
    totalPermissions: effectivePermissions.effective.length,
    effectivePermissions,
    samplePermissions: effectivePermissions.effective.slice(0, 5),
    hierarchyLevel: getRoleLevel(role)
  };
}

// Validate permission context
export function validatePermissionContext(
  userRole: Role,
  permission: string,
  context: EnhancedPermissionContext
): {
  valid: boolean;
  issues: string[];
  recommendations: string[];
} {
  const issues: string[] = [];
  const recommendations: string[] = [];

  // Check for required context fields
  if (!context.tenantId && permission.includes('tenant')) {
    issues.push('Missing tenantId in context for tenant-scoped permission');
    recommendations.push('Provide tenantId in permission context');
  }

  if (!context.userId && (permission.includes(':own') || permission.includes('self'))) {
    issues.push('Missing userId in context for self-scoped permission');
    recommendations.push('Provide userId in permission context');
  }

  // Check for cross-tenant access
  if (context.tenantId && context.targetTenantId && context.tenantId !== context.targetTenantId) {
    if (userRole !== 'superadmin') {
      issues.push('Cross-tenant access attempted by non-superadmin user');
      recommendations.push('Only superadmin users can access cross-tenant resources');
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    recommendations
  };
}