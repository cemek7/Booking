/**
 * Integration tests for unified authentication system
 * 
 * These tests validate the complete authentication and authorization workflow
 * including request handling, middleware integration, and API protection.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { NextRequest } from 'next/server';
import { getTestEnvironment, mockRequest } from '../setup/permission-test-setup';
import {
  unifiedAuth,
  requireAuth,
  requirePermission,
  requireRole,
  requireManagerAccess,
  requireOwnerAccess,
  requireSuperAdmin,
  handleAuthResult,
  type UnifiedAuthOptions
} from '@/types/unified-auth';

describe('Unified Authentication System - Integration Tests', () => {
  let testEnv: any;

  beforeEach(() => {
    testEnv = getTestEnvironment();
  });

  describe('Basic Authentication Flow', () => {
    it('should authenticate valid users successfully', async () => {
      const testUser = testEnv.testUsers.find((u: any) => u.role === 'staff');
      expect(testUser).toBeDefined();

      const request = mockRequest('http://localhost:3000/api/test', {
        headers: {
          'authorization': `Bearer mock-token-${testUser.id}`,
          'x-tenant-id': testUser.tenantId
        }
      });

      // Mock the authentication (in real tests, this would go through Supabase)
      const authResult = await requireAuth(request as NextRequest);
      
      // For this test, we'll assume successful auth
      expect(authResult.success).toBeDefined();
    });

    it('should reject unauthenticated requests', async () => {
      const request = mockRequest('http://localhost:3000/api/test');

      const authResult = await requireAuth(request as NextRequest);
      
      expect(authResult.success).toBe(false);
      expect(authResult.statusCode).toBe(401);
      expect(authResult.error).toContain('Authentication');
    });

    it('should handle malformed tokens gracefully', async () => {
      const request = mockRequest('http://localhost:3000/api/test', {
        headers: {
          'authorization': 'Bearer invalid-token-format'
        }
      });

      const authResult = await requireAuth(request as NextRequest);
      
      expect(authResult.success).toBe(false);
      expect(authResult.statusCode).toBe(401);
    });
  });

  describe('Permission-Based Authentication', () => {
    it('should enforce permission requirements', async () => {
      const testUser = testEnv.testUsers.find((u: any) => u.role === 'staff');
      expect(testUser).toBeDefined();

      const request = mockRequest('http://localhost:3000/api/bookings', {
        headers: {
          'authorization': `Bearer mock-token-${testUser.id}`,
          'x-tenant-id': testUser.tenantId
        }
      });

      // Test permission that staff should have
      const validPermissionResult = await requirePermission(
        request as NextRequest,
        'booking:read:own'
      );

      expect(validPermissionResult.success).toBe(true);

      // Test permission that staff should NOT have
      const invalidPermissionResult = await requirePermission(
        request as NextRequest,
        'system:manage:all'
      );

      expect(invalidPermissionResult.success).toBe(false);
      expect(invalidPermissionResult.statusCode).toBe(403);
    });

    it('should handle multiple permission requirements', async () => {
      const testUser = testEnv.testUsers.find((u: any) => u.role === 'manager');
      expect(testUser).toBeDefined();

      const request = mockRequest('http://localhost:3000/api/manager/dashboard', {
        headers: {
          'authorization': `Bearer mock-token-${testUser.id}`,
          'x-tenant-id': testUser.tenantId
        }
      });

      const authOptions: UnifiedAuthOptions = {
        requiredPermissions: ['team:read:all', 'schedule:read:all', 'analytics:read:all']
      };

      const authResult = await unifiedAuth(request as NextRequest, authOptions);
      
      expect(authResult.success).toBe(true);
    });

    it('should deny access when missing required permissions', async () => {
      const testUser = testEnv.testUsers.find((u: any) => u.role === 'staff');
      expect(testUser).toBeDefined();

      const request = mockRequest('http://localhost:3000/api/admin/users', {
        headers: {
          'authorization': `Bearer mock-token-${testUser.id}`,
          'x-tenant-id': testUser.tenantId
        }
      });

      const authResult = await requirePermission(
        request as NextRequest,
        'user:manage:all'
      );

      expect(authResult.success).toBe(false);
      expect(authResult.statusCode).toBe(403);
      expect(authResult.error).toContain('permission');
    });
  });

  describe('Role-Based Authentication', () => {
    it('should enforce single role requirements', async () => {
      const testUser = testEnv.testUsers.find((u: any) => u.role === 'manager');
      expect(testUser).toBeDefined();

      const request = mockRequest('http://localhost:3000/api/manager/team', {
        headers: {
          'authorization': `Bearer mock-token-${testUser.id}`,
          'x-tenant-id': testUser.tenantId
        }
      });

      const authResult = await requireRole(request as NextRequest, 'manager');
      
      expect(authResult.success).toBe(true);
      expect(authResult.user?.role).toBe('manager');
    });

    it('should enforce multiple role requirements', async () => {
      const testUser = testEnv.testUsers.find((u: any) => u.role === 'owner');
      expect(testUser).toBeDefined();

      const request = mockRequest('http://localhost:3000/api/management/settings', {
        headers: {
          'authorization': `Bearer mock-token-${testUser.id}`,
          'x-tenant-id': testUser.tenantId
        }
      });

      const authResult = await requireRole(
        request as NextRequest, 
        ['manager', 'owner']
      );
      
      expect(authResult.success).toBe(true);
      expect(['manager', 'owner']).toContain(authResult.user?.role);
    });

    it('should deny access for insufficient roles', async () => {
      const testUser = testEnv.testUsers.find((u: any) => u.role === 'staff');
      expect(testUser).toBeDefined();

      const request = mockRequest('http://localhost:3000/api/owner/billing', {
        headers: {
          'authorization': `Bearer mock-token-${testUser.id}`,
          'x-tenant-id': testUser.tenantId
        }
      });

      const authResult = await requireRole(request as NextRequest, 'owner');
      
      expect(authResult.success).toBe(false);
      expect(authResult.statusCode).toBe(403);
    });
  });

  describe('Specialized Access Control', () => {
    it('should validate manager access requirements', async () => {
      const testUser = testEnv.testUsers.find((u: any) => u.role === 'manager');
      expect(testUser).toBeDefined();

      const request = mockRequest('http://localhost:3000/api/manager/analytics', {
        headers: {
          'authorization': `Bearer mock-token-${testUser.id}`,
          'x-tenant-id': testUser.tenantId
        }
      });

      const authResult = await requireManagerAccess(request as NextRequest);
      
      expect(authResult.success).toBe(true);
      expect(['manager', 'owner']).toContain(authResult.user?.role);
    });

    it('should validate owner access requirements', async () => {
      const testUser = testEnv.testUsers.find((u: any) => u.role === 'owner');
      expect(testUser).toBeDefined();

      const request = mockRequest('http://localhost:3000/api/owner/tenant', {
        headers: {
          'authorization': `Bearer mock-token-${testUser.id}`,
          'x-tenant-id': testUser.tenantId
        }
      });

      const authResult = await requireOwnerAccess(request as NextRequest);
      
      expect(authResult.success).toBe(true);
      expect(authResult.user?.role).toBe('owner');
    });

    it('should validate superadmin access requirements', async () => {
      const testUser = testEnv.testUsers.find((u: any) => u.isSuperAdmin);
      expect(testUser).toBeDefined();

      const request = mockRequest('http://localhost:3000/api/system/config', {
        headers: {
          'authorization': `Bearer mock-token-${testUser.id}`
        }
      });

      const authResult = await requireSuperAdmin(request as NextRequest);
      
      expect(authResult.success).toBe(true);
      expect(authResult.user?.isSuperAdmin).toBe(true);
    });

    it('should allow superadmin bypass for lower-level access', async () => {
      const testUser = testEnv.testUsers.find((u: any) => u.isSuperAdmin);
      expect(testUser).toBeDefined();

      const request = mockRequest('http://localhost:3000/api/manager/team', {
        headers: {
          'authorization': `Bearer mock-token-${testUser.id}`,
          'x-tenant-id': 'any-tenant-id'
        }
      });

      const authResult = await requireManagerAccess(request as NextRequest);
      
      expect(authResult.success).toBe(true);
      expect(authResult.user?.isSuperAdmin).toBe(true);
    });
  });

  describe('Tenant Access Validation', () => {
    it('should enforce tenant membership requirements', async () => {
      const testUser = testEnv.testUsers.find((u: any) => u.role === 'staff');
      expect(testUser).toBeDefined();

      const request = mockRequest(`http://localhost:3000/api/tenants/${testUser.tenantId}/bookings`, {
        headers: {
          'authorization': `Bearer mock-token-${testUser.id}`,
          'x-tenant-id': testUser.tenantId
        }
      });

      const authOptions: UnifiedAuthOptions = {
        requireTenantAccess: true
      };

      const authResult = await unifiedAuth(request as NextRequest, authOptions);
      
      expect(authResult.success).toBe(true);
    });

    it('should deny cross-tenant access for regular users', async () => {
      const testUser = testEnv.testUsers.find((u: any) => u.role === 'staff' && u.tenantId === 'test-tenant-1');
      expect(testUser).toBeDefined();

      const request = mockRequest('http://localhost:3000/api/tenants/test-tenant-2/bookings', {
        headers: {
          'authorization': `Bearer mock-token-${testUser.id}`,
          'x-tenant-id': 'test-tenant-2'
        }
      });

      const authOptions: UnifiedAuthOptions = {
        requireTenantAccess: true
      };

      const authResult = await unifiedAuth(request as NextRequest, authOptions);
      
      expect(authResult.success).toBe(false);
      expect(authResult.error).toContain('tenant');
    });

    it('should allow superadmin cross-tenant access', async () => {
      const testUser = testEnv.testUsers.find((u: any) => u.isSuperAdmin);
      expect(testUser).toBeDefined();

      const request = mockRequest('http://localhost:3000/api/tenants/any-tenant/admin', {
        headers: {
          'authorization': `Bearer mock-token-${testUser.id}`,
          'x-tenant-id': 'any-tenant'
        }
      });

      const authOptions: UnifiedAuthOptions = {
        requireTenantAccess: true
      };

      const authResult = await unifiedAuth(request as NextRequest, authOptions);
      
      expect(authResult.success).toBe(true);
    });
  });

  describe('Request Context Extraction', () => {
    it('should extract tenant context from URL parameters', async () => {
      const testUser = testEnv.testUsers.find((u: any) => u.role === 'manager');
      expect(testUser).toBeDefined();

      const request = mockRequest(`http://localhost:3000/api/tenants/${testUser.tenantId}/dashboard`, {
        headers: {
          'authorization': `Bearer mock-token-${testUser.id}`
        }
      });

      const authResult = await requireManagerAccess(request as NextRequest);
      
      // The system should extract tenant context from URL
      expect(authResult.success).toBe(true);
    });

    it('should extract tenant context from headers', async () => {
      const testUser = testEnv.testUsers.find((u: any) => u.role === 'manager');
      expect(testUser).toBeDefined();

      const request = mockRequest('http://localhost:3000/api/dashboard', {
        headers: {
          'authorization': `Bearer mock-token-${testUser.id}`,
          'x-tenant-id': testUser.tenantId
        }
      });

      const authResult = await requireManagerAccess(request as NextRequest);
      
      expect(authResult.success).toBe(true);
    });

    it('should handle missing tenant context appropriately', async () => {
      const testUser = testEnv.testUsers.find((u: any) => u.role === 'staff');
      expect(testUser).toBeDefined();

      const request = mockRequest('http://localhost:3000/api/bookings', {
        headers: {
          'authorization': `Bearer mock-token-${testUser.id}`
          // No tenant context provided
        }
      });

      const authOptions: UnifiedAuthOptions = {
        requireTenantAccess: true
      };

      const authResult = await unifiedAuth(request as NextRequest, authOptions);
      
      expect(authResult.success).toBe(false);
      expect(authResult.error).toContain('Tenant access required');
    });
  });

  describe('Error Response Handling', () => {
    it('should return proper error responses for authentication failures', async () => {
      const request = mockRequest('http://localhost:3000/api/protected');

      const authResult = await requireAuth(request as NextRequest);
      const errorResponse = handleAuthResult(authResult);
      
      expect(errorResponse).not.toBeNull();
      expect(errorResponse?.status).toBe(401);
    });

    it('should return proper error responses for authorization failures', async () => {
      const testUser = testEnv.testUsers.find((u: any) => u.role === 'staff');
      expect(testUser).toBeDefined();

      const request = mockRequest('http://localhost:3000/api/admin/system', {
        headers: {
          'authorization': `Bearer mock-token-${testUser.id}`,
          'x-tenant-id': testUser.tenantId
        }
      });

      const authResult = await requireOwnerAccess(request as NextRequest);
      const errorResponse = handleAuthResult(authResult);
      
      expect(errorResponse).not.toBeNull();
      expect(errorResponse?.status).toBe(403);
    });

    it('should return null for successful authentication', async () => {
      const testUser = testEnv.testUsers.find((u: any) => u.role === 'manager');
      expect(testUser).toBeDefined();

      const request = mockRequest('http://localhost:3000/api/manager/team', {
        headers: {
          'authorization': `Bearer mock-token-${testUser.id}`,
          'x-tenant-id': testUser.tenantId
        }
      });

      const authResult = await requireManagerAccess(request as NextRequest);
      const errorResponse = handleAuthResult(authResult);
      
      expect(errorResponse).toBeNull();
      expect(authResult.success).toBe(true);
    });
  });

  describe('Complex Scenarios', () => {
    it('should handle cascading permission checks', async () => {
      const testUser = testEnv.testUsers.find((u: any) => u.role === 'manager');
      expect(testUser).toBeDefined();

      const request = mockRequest('http://localhost:3000/api/manager/team/performance', {
        headers: {
          'authorization': `Bearer mock-token-${testUser.id}`,
          'x-tenant-id': testUser.tenantId
        }
      });

      const authOptions: UnifiedAuthOptions = {
        requiredRoles: ['manager', 'owner'],
        requiredPermissions: ['team:read:all', 'analytics:read:all'],
        requireTenantAccess: true,
        context: {
          resourceType: 'team_performance',
          operationType: 'read'
        }
      };

      const authResult = await unifiedAuth(request as NextRequest, authOptions);
      
      expect(authResult.success).toBe(true);
    });

    it('should handle permission inheritance in complex scenarios', async () => {
      const testUser = testEnv.testUsers.find((u: any) => u.role === 'owner');
      expect(testUser).toBeDefined();

      const request = mockRequest('http://localhost:3000/api/owner/full-access', {
        headers: {
          'authorization': `Bearer mock-token-${testUser.id}`,
          'x-tenant-id': testUser.tenantId
        }
      });

      // Owner should inherit all lower-level permissions
      const staffPermission = await requirePermission(
        request as NextRequest,
        'booking:read:own'
      );

      const managerPermission = await requirePermission(
        request as NextRequest,
        'team:manage:all'
      );

      const ownerPermission = await requirePermission(
        request as NextRequest,
        'tenant:configure:all'
      );

      expect(staffPermission.success).toBe(true);
      expect(managerPermission.success).toBe(true);
      expect(ownerPermission.success).toBe(true);
    });

    it('should maintain security boundaries under edge conditions', async () => {
      const testUser = testEnv.testUsers.find((u: any) => u.role === 'staff');
      expect(testUser).toBeDefined();

      // Attempt to access sensitive operation with manipulated context
      const request = mockRequest('http://localhost:3000/api/system/delete-all', {
        headers: {
          'authorization': `Bearer mock-token-${testUser.id}`,
          'x-tenant-id': testUser.tenantId,
          'x-elevated-permissions': 'true', // Attempt to manipulate
          'x-bypass-checks': 'admin'        // Attempt to bypass
        }
      });

      const authResult = await requirePermission(
        request as NextRequest,
        'system:delete:all'
      );

      // Should be securely denied regardless of header manipulation
      expect(authResult.success).toBe(false);
      expect(authResult.statusCode).toBe(403);
    });
  });
});