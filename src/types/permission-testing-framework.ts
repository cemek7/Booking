/**
 * permission-testing-framework.ts — stub
 *
 * This file was deleted as part of the auth simplification but is still
 * imported by legacy test setup files. Providing minimal exports so those
 * test suites can run.
 */

export interface TestUser {
  id: string;
  email: string;
  role: 'superadmin' | 'owner' | 'manager' | 'staff';
  tenantId: string;
  isSuperAdmin?: boolean;
}

export interface PermissionChecker {
  hasPermission(userId: string, tenantId: string, permission: string): Promise<boolean>;
}

export interface TestEnvironment {
  supabase: unknown;
  permissionChecker: PermissionChecker;
  testUsers: TestUser[];
  cleanup: () => Promise<void>;
}

const TEST_USERS: TestUser[] = [
  { id: 'superadmin-user', email: 'superadmin@example.com', role: 'superadmin', tenantId: 'test-tenant-id', isSuperAdmin: true },
  { id: 'owner-user', email: 'owner@example.com', role: 'owner', tenantId: 'test-tenant-id', isSuperAdmin: false },
  { id: 'manager-user', email: 'manager@example.com', role: 'manager', tenantId: 'test-tenant-1', isSuperAdmin: false },
  { id: 'staff-user', email: 'staff@example.com', role: 'staff', tenantId: 'test-tenant-id', isSuperAdmin: false },
  { id: 'staff-user-2', email: 'staff2@example.com', role: 'staff', tenantId: 'test-tenant-id', isSuperAdmin: false },
];

// Role hierarchy: higher index = lower privilege
const ROLE_HIERARCHY = ['superadmin', 'owner', 'manager', 'staff'];

// Permission grants by role (simplified)
const ROLE_PERMISSIONS: Record<string, string[]> = {
  superadmin: ['*', 'system:manage:all', 'booking:read:own', 'booking:read:all', 'tenant:manage:all'],
  owner: ['booking:read:own', 'booking:read:all', 'booking:write:all', 'staff:manage:all', 'tenant:manage:own'],
  manager: ['booking:read:own', 'booking:read:all', 'booking:write:all', 'staff:read:all'],
  staff: ['booking:read:own', 'booking:write:own'],
};

function createPermissionChecker(): PermissionChecker {
  return {
    async hasPermission(userId: string, _tenantId: string, permission: string): Promise<boolean> {
      const user = TEST_USERS.find(u => u.id === userId);
      if (!user) return false;
      const perms = ROLE_PERMISSIONS[user.role] || [];
      if (perms.includes('*')) return true;
      return perms.includes(permission);
    }
  };
}

/**
 * Sets up a minimal test environment with mock Supabase client.
 */
export async function setupTestEnvironment(): Promise<TestEnvironment> {
  return {
    supabase: null,
    permissionChecker: createPermissionChecker(),
    testUsers: TEST_USERS,
    cleanup: async () => {},
  };
}
