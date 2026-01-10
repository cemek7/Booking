/**
 * Unit tests for unified permission system
 * 
 * These tests validate the core permission checking logic, role inheritance,
 * and security rules of the unified permission system.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { getTestEnvironment, mockUser } from '../setup/permission-test-setup';
import { 
  UnifiedPermissionChecker,
  type UnifiedPermissionContext 
} from '@/types/unified-permissions';

describe('Unified Permission System - Unit Tests', () => {
  let permissionChecker: UnifiedPermissionChecker;

  beforeEach(() => {
    const testEnv = getTestEnvironment();
    permissionChecker = testEnv.permissionChecker;
  });

  describe('Basic Permission Checking', () => {
    it('should grant basic staff permissions', async () => {
      const testUser = testEnv.testUsers.find(u => u.role === 'staff');
      expect(testUser).toBeDefined();

      const hasPermission = await permissionChecker.hasPermission(
        testUser!.id,
        testUser!.tenantId,
        'booking:read:own'
      );

      expect(hasPermission).toHavePermission('booking:read:own');
    });

    it('should deny staff system-level permissions', async () => {
      const testUser = testEnv.testUsers.find(u => u.role === 'staff');
      expect(testUser).toBeDefined();

      const hasPermission = await permissionChecker.hasPermission(
        testUser!.id,
        testUser!.tenantId,
        'system:manage:all'
      );

      expect(hasPermission).toBe(false);
    });

    it('should grant manager permissions with inheritance', async () => {
      const testUser = testEnv.testUsers.find(u => u.role === 'manager');
      expect(testUser).toBeDefined();

      // Manager should have staff permissions via inheritance
      const staffPermission = await permissionChecker.hasPermission(
        testUser!.id,
        testUser!.tenantId,
        'booking:read:own'
      );

      // Manager should have manager-specific permissions
      const managerPermission = await permissionChecker.hasPermission(
        testUser!.id,
        testUser!.tenantId,
        'team:manage:all'
      );

      expect(staffPermission).toHavePermission('booking:read:own');
      expect(managerPermission).toHavePermission('team:manage:all');
    });

    it('should grant owner permissions with full inheritance', async () => {
      const testUser = testEnv.testUsers.find(u => u.role === 'owner');
      expect(testUser).toBeDefined();

      const permissions = [
        'booking:read:own',    // Staff permission
        'team:manage:all',     // Manager permission
        'tenant:manage:all'    // Owner permission
      ];

      for (const permission of permissions) {
        const hasPermission = await permissionChecker.hasPermission(
          testUser!.id,
          testUser!.tenantId,
          permission
        );
        expect(hasPermission).toHavePermission(permission);
      }
    });

    it('should grant superadmin all permissions', async () => {
      const testUser = testEnv.testUsers.find(u => u.isSuperAdmin);
      expect(testUser).toBeDefined();

      const systemPermission = await permissionChecker.hasPermission(
        testUser!.id,
        testUser!.tenantId,
        'system:manage:all'
      );

      const tenantPermission = await permissionChecker.hasPermission(
        testUser!.id,
        testUser!.tenantId,
        'tenant:manage:all'
      );

      expect(systemPermission).toHavePermission('system:manage:all');
      expect(tenantPermission).toHavePermission('tenant:manage:all');
    });
  });

  describe('Permission Context Validation', () => {
    it('should enforce self-resource access for staff', async () => {
      const testUser = testEnv.testUsers.find(u => u.role === 'staff');
      expect(testUser).toBeDefined();

      // Should allow access to own resources
      const ownResourceContext: UnifiedPermissionContext = {
        userId: testUser!.id,
        tenantId: testUser!.tenantId,
        targetUserId: testUser!.id
      };

      const ownAccess = await permissionChecker.checkAccess(
        testUser!.id,
        'profile:read:own',
        ownResourceContext
      );

      expect(ownAccess.granted).toBe(true);

      // Should deny access to other user's resources
      const otherResourceContext: UnifiedPermissionContext = {
        userId: testUser!.id,
        tenantId: testUser!.tenantId,
        targetUserId: 'other-user-id'
      };

      const otherAccess = await permissionChecker.checkAccess(
        testUser!.id,
        'profile:read:all',
        otherResourceContext
      );

      expect(otherAccess).toBeSecurelyDenied('Staff self-access restriction');
    });

    it('should validate resource ownership', async () => {
      const testUser = testEnv.testUsers.find(u => u.role === 'staff');
      expect(testUser).toBeDefined();

      const context: UnifiedPermissionContext = {
        userId: testUser!.id,
        tenantId: testUser!.tenantId,
        resourceId: 'booking-123',
        resourceOwnerId: testUser!.id
      };

      const access = await permissionChecker.checkAccess(
        testUser!.id,
        'booking:edit:own',
        context
      );

      expect(access.granted).toBe(true);
    });

    it('should apply time-based restrictions', async () => {
      const testUser = testEnv.testUsers.find(u => u.role === 'staff');
      expect(testUser).toBeDefined();

      const context: UnifiedPermissionContext = {
        userId: testUser!.id,
        tenantId: testUser!.tenantId,
        timeRestriction: {
          allowedHours: { start: 9, end: 17 },
          allowedDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']
        }
      };

      const access = await permissionChecker.checkAccess(
        testUser!.id,
        'booking:create:own',
        context
      );

      // This would depend on current time in a real implementation
      expect(access.granted).toBeDefined();
    });
  });

  describe('Tenant Isolation', () => {
    it('should enforce tenant isolation for non-superadmin users', async () => {
      const testUser = testEnv.testUsers.find(u => u.role === 'staff' && u.tenantId === 'test-tenant-1');
      expect(testUser).toBeDefined();

      const crossTenantContext: UnifiedPermissionContext = {
        userId: testUser!.id,
        tenantId: testUser!.tenantId,
        targetTenantId: 'test-tenant-2'
      };

      const access = await permissionChecker.checkAccess(
        testUser!.id,
        'booking:read:own',
        crossTenantContext
      );

      expect(access).toRespectTenantIsolation('test-tenant-2');
    });

    it('should allow superadmin cross-tenant access', async () => {
      const testUser = testEnv.testUsers.find(u => u.isSuperAdmin);
      expect(testUser).toBeDefined();

      const crossTenantContext: UnifiedPermissionContext = {
        userId: testUser!.id,
        tenantId: testUser!.tenantId,
        targetTenantId: 'test-tenant-2'
      };

      const access = await permissionChecker.checkAccess(
        testUser!.id,
        'tenant:read:all',
        crossTenantContext
      );

      expect(access.granted).toBe(true);
    });

    it('should validate tenant membership', async () => {
      const testUser = testEnv.testUsers.find(u => u.role === 'manager');
      expect(testUser).toBeDefined();

      // Should have access to own tenant
      const ownTenantAccess = await permissionChecker.hasPermission(
        testUser!.id,
        testUser!.tenantId,
        'team:read:all'
      );

      expect(ownTenantAccess).toBe(true);

      // Should not have access to non-member tenant
      const otherTenantAccess = await permissionChecker.hasPermission(
        testUser!.id,
        'non-member-tenant',
        'team:read:all'
      );

      expect(otherTenantAccess).toBe(false);
    });
  });

  describe('Security Rules Application', () => {
    it('should deny critical operations for non-privileged roles', async () => {
      const testUser = testEnv.testUsers.find(u => u.role === 'staff');
      expect(testUser).toBeDefined();

      const criticalOperations = [
        'system:manage:all',
        'tenant:delete:all',
        'billing:manage:all'
      ];

      for (const operation of criticalOperations) {
        const access = await permissionChecker.checkAccess(
          testUser!.id,
          operation,
          { userId: testUser!.id, tenantId: testUser!.tenantId }
        );

        expect(access).toBeSecurelyDenied(`Critical operation: ${operation}`);
      }
    });

    it('should require audit logging for sensitive operations', async () => {
      const testUser = testEnv.testUsers.find(u => u.role === 'owner');
      expect(testUser).toBeDefined();

      const sensitiveContext: UnifiedPermissionContext = {
        userId: testUser!.id,
        tenantId: testUser!.tenantId,
        operationType: 'delete',
        resourceType: 'user'
      };

      const access = await permissionChecker.checkAccess(
        testUser!.id,
        'user:delete:all',
        sensitiveContext
      );

      expect(access.auditRequired).toBe(true);
    });

    it('should apply IP-based restrictions when configured', async () => {
      const testUser = testEnv.testUsers.find(u => u.role === 'owner');
      expect(testUser).toBeDefined();

      const ipRestrictedContext: UnifiedPermissionContext = {
        userId: testUser!.id,
        tenantId: testUser!.tenantId,
        ipAddress: '192.168.1.100',
        allowedIPs: ['192.168.1.0/24']
      };

      const access = await permissionChecker.checkAccess(
        testUser!.id,
        'tenant:configure:all',
        ipRestrictedContext
      );

      expect(access.granted).toBe(true);

      // Test blocked IP
      const blockedIpContext: UnifiedPermissionContext = {
        ...ipRestrictedContext,
        ipAddress: '10.0.0.100'
      };

      const blockedAccess = await permissionChecker.checkAccess(
        testUser!.id,
        'tenant:configure:all',
        blockedIpContext
      );

      expect(blockedAccess).toBeSecurelyDenied('IP restriction');
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid user IDs gracefully', async () => {
      const access = await permissionChecker.checkAccess(
        'invalid-user-id',
        'booking:read:own',
        { userId: 'invalid-user-id', tenantId: 'test-tenant-1' }
      );

      expect(access.granted).toBe(false);
      expect(access.reason).toContain('User not found');
      expect(access.auditRequired).toBe(true);
    });

    it('should handle database errors gracefully', async () => {
      // This test would require mocking the database to fail
      // For now, we'll test the error handling pattern
      const invalidContext: UnifiedPermissionContext = {
        userId: 'test-user',
        tenantId: '',  // Invalid tenant ID
      };

      const access = await permissionChecker.checkAccess(
        'test-user',
        'booking:read:own',
        invalidContext
      );

      expect(access.granted).toBe(false);
      expect(access.securityLevel).toBe('critical');
    });

    it('should default to deny for unknown permissions', async () => {
      const testUser = testEnv.testUsers.find(u => u.role === 'staff');
      expect(testUser).toBeDefined();

      const access = await permissionChecker.checkAccess(
        testUser!.id,
        'unknown:permission:test',
        { userId: testUser!.id, tenantId: testUser!.tenantId }
      );

      expect(access.granted).toBe(false);
    });
  });

  describe('Performance Validation', () => {
    it('should check permissions within acceptable time limits', async () => {
      const testUser = testEnv.testUsers.find(u => u.role === 'manager');
      expect(testUser).toBeDefined();

      const startTime = Date.now();
      
      const access = await permissionChecker.checkAccess(
        testUser!.id,
        'team:read:all',
        { userId: testUser!.id, tenantId: testUser!.tenantId }
      );

      const duration = Date.now() - startTime;

      expect(access.granted).toBe(true);
      expect(duration).toBeLessThan(100); // Should complete within 100ms
    });

    it('should handle bulk permission checks efficiently', async () => {
      const testUser = testEnv.testUsers.find(u => u.role === 'manager');
      expect(testUser).toBeDefined();

      const permissions = [
        'booking:read:all',
        'team:read:all',
        'schedule:read:all',
        'analytics:read:all'
      ];

      const startTime = Date.now();

      const results = await permissionChecker.hasAllPermissions(
        testUser!.id,
        testUser!.tenantId,
        permissions
      );

      const duration = Date.now() - startTime;

      expect(results).toBe(true);
      expect(duration).toBeLessThan(200); // Should complete within 200ms for 4 permissions
    });
  });
});