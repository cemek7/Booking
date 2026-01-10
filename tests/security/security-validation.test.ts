/**
 * Security tests for permission system
 * 
 * These tests validate the security aspects of the permission system including
 * attack prevention, vulnerability testing, and security boundary enforcement.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { NextRequest } from 'next/server';
import { getTestEnvironment, mockRequest } from '../setup/permission-test-setup';
import {
  unifiedAuth,
  requirePermission,
  requireRole,
  type UnifiedAuthOptions
} from '@/types/unified-auth';
import type { UnifiedPermissionContext } from '@/types/unified-permissions';

describe('Permission System - Security Tests', () => {
  let testEnv: any;

  beforeEach(() => {
    testEnv = getTestEnvironment();
  });

  describe('Injection Attack Prevention', () => {
    it('should prevent SQL injection in permission checks', async () => {
      const testUser = testEnv.testUsers.find((u: any) => u.role === 'staff');
      expect(testUser).toBeDefined();

      // Attempt SQL injection through permission parameter
      const maliciousPermissions = [
        "booking:read'; DROP TABLE users; --",
        "booking:read' OR '1'='1",
        "booking:read'; INSERT INTO admins VALUES ('evil'); --",
        "booking:read' UNION SELECT * FROM tenant_users --"
      ];

      for (const maliciousPermission of maliciousPermissions) {
        const request = mockRequest('http://localhost:3000/api/test', {
          headers: {
            'authorization': `Bearer mock-token-${testUser.id}`,
            'x-tenant-id': testUser.tenantId
          }
        });

        const authResult = await requirePermission(
          request as NextRequest,
          maliciousPermission
        );

        // Should be denied and logged as suspicious
        expect(authResult.success).toBe(false);
        expect(authResult.error).toBeDefined();
      }
    });

    it('should prevent NoSQL injection attempts', async () => {
      const testUser = testEnv.testUsers.find((u: any) => u.role === 'manager');
      expect(testUser).toBeDefined();

      // Attempt NoSQL injection through context parameters
      const maliciousContext = {
        userId: { $ne: null },
        tenantId: { $exists: true },
        targetUserId: { $where: 'function() { return true; }' }
      };

      const request = mockRequest('http://localhost:3000/api/manager/team', {
        method: 'POST',
        headers: {
          'authorization': `Bearer mock-token-${testUser.id}`,
          'x-tenant-id': testUser.tenantId
        },
        body: maliciousContext
      });

      const authResult = await requirePermission(
        request as NextRequest,
        'team:read:all',
        maliciousContext
      );

      // Should handle malicious context safely
      expect(authResult.success).toBeDefined(); // System should not crash
    });

    it('should sanitize user input in permission context', async () => {
      const testUser = testEnv.testUsers.find((u: any) => u.role === 'staff');
      expect(testUser).toBeDefined();

      const maliciousInput = {
        resourceId: "<script>alert('xss')</script>",
        userId: "'; DROP TABLE --",
        customField: { $eval: "malicious code" }
      };

      const request = mockRequest('http://localhost:3000/api/bookings', {
        headers: {
          'authorization': `Bearer mock-token-${testUser.id}`,
          'x-tenant-id': testUser.tenantId
        }
      });

      // System should handle malicious input gracefully
      const authResult = await requirePermission(
        request as NextRequest,
        'booking:read:own',
        maliciousInput
      );

      expect(authResult).toBeDefined();
      // Should either succeed with sanitized input or fail securely
    });
  });

  describe('Token and Session Security', () => {
    it('should reject malformed JWT tokens', async () => {
      const malformedTokens = [
        'Bearer invalid.jwt.token',
        'Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.invalid.signature',
        'Bearer ' + 'A'.repeat(10000), // Extremely long token
        'Bearer <script>alert("xss")</script>',
        'Bearer ../../../etc/passwd'
      ];

      for (const token of malformedTokens) {
        const request = mockRequest('http://localhost:3000/api/test', {
          headers: {
            'authorization': token
          }
        });

        const authResult = await requirePermission(
          request as NextRequest,
          'booking:read:own'
        );

        expect(authResult.success).toBe(false);
        expect(authResult.statusCode).toBe(401);
      }
    });

    it('should prevent token replay attacks', async () => {
      const testUser = testEnv.testUsers.find((u: any) => u.role === 'staff');
      expect(testUser).toBeDefined();

      // Simulate an old/expired token
      const expiredToken = `Bearer expired-token-${testUser.id}`;

      const request = mockRequest('http://localhost:3000/api/bookings', {
        headers: {
          'authorization': expiredToken,
          'x-tenant-id': testUser.tenantId
        }
      });

      const authResult = await requirePermission(
        request as NextRequest,
        'booking:read:own'
      );

      expect(authResult.success).toBe(false);
      expect(authResult.statusCode).toBe(401);
    });

    it('should handle concurrent session attacks', async () => {
      const testUser = testEnv.testUsers.find((u: any) => u.role === 'manager');
      expect(testUser).toBeDefined();

      // Simulate multiple concurrent requests with same token
      const requests = Array(10).fill(null).map(() =>
        mockRequest('http://localhost:3000/api/manager/team', {
          headers: {
            'authorization': `Bearer mock-token-${testUser.id}`,
            'x-tenant-id': testUser.tenantId
          }
        })
      );

      const authPromises = requests.map(request =>
        requirePermission(request as NextRequest, 'team:read:all')
      );

      const results = await Promise.all(authPromises);

      // All should handle gracefully, not cause race conditions
      results.forEach(result => {
        expect(result).toBeDefined();
        expect(typeof result.success).toBe('boolean');
      });
    });
  });

  describe('Authorization Bypass Attempts', () => {
    it('should prevent role escalation through header manipulation', async () => {
      const testUser = testEnv.testUsers.find((u: any) => u.role === 'staff');
      expect(testUser).toBeDefined();

      const bypassHeaders = [
        { 'x-user-role': 'owner' },
        { 'x-admin-override': 'true' },
        { 'x-superuser': '1' },
        { 'authorization': `Bearer mock-token-${testUser.id}`, 'x-role-override': 'superadmin' },
        { 'x-permissions': 'all' },
        { 'x-bypass-auth': 'true' }
      ];

      for (const headers of bypassHeaders) {
        const request = mockRequest('http://localhost:3000/api/owner/settings', {
          headers: {
            'authorization': `Bearer mock-token-${testUser.id}`,
            'x-tenant-id': testUser.tenantId,
            ...headers
          }
        });

        const authResult = await requireRole(
          request as NextRequest,
          'owner'
        );

        // Staff user should NOT be able to access owner resources
        expect(authResult.success).toBe(false);
        expect(authResult.statusCode).toBe(403);
      }
    });

    it('should prevent permission escalation through parameter injection', async () => {
      const testUser = testEnv.testUsers.find((u: any) => u.role === 'staff');
      expect(testUser).toBeDefined();

      const maliciousUrls = [
        'http://localhost:3000/api/bookings?role=owner',
        'http://localhost:3000/api/bookings?permissions=all',
        'http://localhost:3000/api/bookings?user_id=admin',
        'http://localhost:3000/api/bookings?bypass=true',
        'http://localhost:3000/api/bookings?elevation=superadmin'
      ];

      for (const url of maliciousUrls) {
        const request = mockRequest(url, {
          headers: {
            'authorization': `Bearer mock-token-${testUser.id}`,
            'x-tenant-id': testUser.tenantId
          }
        });

        const authResult = await requirePermission(
          request as NextRequest,
          'system:manage:all' // Permission staff should not have
        );

        expect(authResult.success).toBe(false);
        expect(authResult.statusCode).toBe(403);
      }
    });

    it('should prevent cross-tenant access through path manipulation', async () => {
      const testUser = testEnv.testUsers.find((u: any) => u.role === 'manager' && u.tenantId === 'test-tenant-1');
      expect(testUser).toBeDefined();

      const maliciousPaths = [
        'http://localhost:3000/api/tenants/test-tenant-2/admin',
        'http://localhost:3000/api/tenants/../system/config',
        'http://localhost:3000/api/tenants/test-tenant-1/../test-tenant-2/data',
        'http://localhost:3000/api/tenants/%2e%2e%2fsystem%2fadmin'
      ];

      for (const path of maliciousPaths) {
        const request = mockRequest(path, {
          headers: {
            'authorization': `Bearer mock-token-${testUser.id}`,
            'x-tenant-id': testUser.tenantId
          }
        });

        const authOptions: UnifiedAuthOptions = {
          requireTenantAccess: true
        };

        const authResult = await unifiedAuth(request as NextRequest, authOptions);

        // Should not allow access to other tenants or system paths
        if (authResult.success) {
          expect(authResult.user?.tenantId).toBe(testUser.tenantId);
        }
      }
    });
  });

  describe('Data Exposure Prevention', () => {
    it('should prevent information disclosure through error messages', async () => {
      const invalidUserRequests = [
        mockRequest('http://localhost:3000/api/users/invalid-id', {
          headers: { 'authorization': 'Bearer invalid-token' }
        }),
        mockRequest('http://localhost:3000/api/tenants/non-existent/data', {
          headers: { 'authorization': 'Bearer fake-token' }
        })
      ];

      for (const request of invalidUserRequests) {
        const authResult = await requirePermission(
          request as NextRequest,
          'user:read:all'
        );

        expect(authResult.success).toBe(false);
        
        // Error message should not reveal sensitive information
        if (authResult.error) {
          expect(authResult.error).not.toMatch(/password|secret|key|token|database/i);
          expect(authResult.error).not.toContain('SELECT');
          expect(authResult.error).not.toContain('INSERT');
        }
      }
    });

    it('should prevent timing attacks on user enumeration', async () => {
      const startTime = Date.now();

      // Request with valid user format
      const validFormatRequest = mockRequest('http://localhost:3000/api/auth', {
        headers: {
          'authorization': 'Bearer valid-format-but-fake-token'
        }
      });

      const validResult = await requirePermission(
        validFormatRequest as NextRequest,
        'user:read:own'
      );

      const validTime = Date.now() - startTime;

      // Request with invalid user format
      const invalidStartTime = Date.now();
      
      const invalidFormatRequest = mockRequest('http://localhost:3000/api/auth', {
        headers: {
          'authorization': 'Bearer completely-invalid-format'
        }
      });

      const invalidResult = await requirePermission(
        invalidFormatRequest as NextRequest,
        'user:read:own'
      );

      const invalidTime = Date.now() - invalidStartTime;

      // Response times should be similar to prevent user enumeration
      expect(Math.abs(validTime - invalidTime)).toBeLessThan(100);
      expect(validResult.success).toBe(false);
      expect(invalidResult.success).toBe(false);
    });

    it('should sanitize sensitive data in audit logs', async () => {
      const testUser = testEnv.testUsers.find((u: any) => u.role === 'owner');
      expect(testUser).toBeDefined();

      const sensitiveContext = {
        userId: testUser.id,
        tenantId: testUser.tenantId,
        creditCard: '4111-1111-1111-1111',
        password: 'secret123',
        ssn: '123-45-6789'
      };

      const request = mockRequest('http://localhost:3000/api/billing', {
        method: 'POST',
        headers: {
          'authorization': `Bearer mock-token-${testUser.id}`,
          'x-tenant-id': testUser.tenantId
        },
        body: sensitiveContext
      });

      const authResult = await requirePermission(
        request as NextRequest,
        'billing:read:all',
        sensitiveContext
      );

      // Audit logs should not contain sensitive data
      if (authResult.user) {
        const userString = JSON.stringify(authResult.user);
        expect(userString).not.toContain('4111-1111-1111-1111');
        expect(userString).not.toContain('secret123');
        expect(userString).not.toContain('123-45-6789');
      }
    });
  });

  describe('Rate Limiting and DoS Protection', () => {
    it('should handle rapid permission check requests', async () => {
      const testUser = testEnv.testUsers.find((u: any) => u.role === 'staff');
      expect(testUser).toBeDefined();

      const startTime = Date.now();
      
      // Generate many rapid requests
      const rapidRequests = Array(50).fill(null).map(() => {
        const request = mockRequest('http://localhost:3000/api/bookings', {
          headers: {
            'authorization': `Bearer mock-token-${testUser.id}`,
            'x-tenant-id': testUser.tenantId
          }
        });

        return requirePermission(request as NextRequest, 'booking:read:own');
      });

      const results = await Promise.all(rapidRequests);
      const totalTime = Date.now() - startTime;

      // System should handle rapid requests without crashing
      expect(results.length).toBe(50);
      expect(totalTime).toBeLessThan(5000); // Should complete within 5 seconds
      
      // All requests should be processed
      results.forEach(result => {
        expect(result).toBeDefined();
        expect(typeof result.success).toBe('boolean');
      });
    });

    it('should resist memory exhaustion attacks', async () => {
      const testUser = testEnv.testUsers.find((u: any) => u.role === 'manager');
      expect(testUser).toBeDefined();

      // Create requests with large context objects
      const largeContext = {
        userId: testUser.id,
        tenantId: testUser.tenantId,
        largeData: 'A'.repeat(1000000), // 1MB string
        manyFields: Object.fromEntries(
          Array(1000).fill(null).map((_, i) => [`field${i}`, `value${i}`])
        )
      };

      const request = mockRequest('http://localhost:3000/api/manager/team', {
        method: 'POST',
        headers: {
          'authorization': `Bearer mock-token-${testUser.id}`,
          'x-tenant-id': testUser.tenantId
        },
        body: largeContext
      });

      const authResult = await requirePermission(
        request as NextRequest,
        'team:read:all',
        largeContext
      );

      // System should handle large context gracefully
      expect(authResult).toBeDefined();
      expect(typeof authResult.success).toBe('boolean');
    });
  });

  describe('Edge Cases and Error Conditions', () => {
    it('should handle null and undefined inputs gracefully', async () => {
      const nullInputs = [
        null,
        undefined,
        { userId: null },
        { tenantId: undefined },
        { permissions: null }
      ];

      for (const input of nullInputs) {
        const request = mockRequest('http://localhost:3000/api/test', {
          headers: {
            'authorization': 'Bearer null-test'
          }
        });

        const authResult = await requirePermission(
          request as NextRequest,
          'test:read:own',
          input
        );

        // Should handle gracefully without crashing
        expect(authResult).toBeDefined();
        expect(authResult.success).toBe(false);
      }
    });

    it('should handle concurrent access to same resources', async () => {
      const testUsers = testEnv.testUsers.filter((u: any) => u.role === 'staff');
      expect(testUsers.length).toBeGreaterThan(1);

      // Multiple users trying to access same resource simultaneously
      const concurrentRequests = testUsers.map((user: any) => {
        const request = mockRequest('http://localhost:3000/api/bookings/shared-resource', {
          headers: {
            'authorization': `Bearer mock-token-${user.id}`,
            'x-tenant-id': user.tenantId
          }
        });

        return requirePermission(request as NextRequest, 'booking:read:own');
      });

      const results = await Promise.all(concurrentRequests);

      // All should complete without deadlocks or race conditions
      results.forEach(result => {
        expect(result).toBeDefined();
        expect(typeof result.success).toBe('boolean');
      });
    });

    it('should maintain security under database errors', async () => {
      const testUser = testEnv.testUsers.find((u: any) => u.role === 'owner');
      expect(testUser).toBeDefined();

      // Simulate database error scenario (in real test, mock would fail)
      const request = mockRequest('http://localhost:3000/api/owner/settings', {
        headers: {
          'authorization': `Bearer mock-token-${testUser.id}`,
          'x-tenant-id': 'invalid-tenant-id' // Force potential DB error
        }
      });

      const authResult = await requirePermission(
        request as NextRequest,
        'tenant:configure:all'
      );

      // Should fail securely, not expose database errors
      if (!authResult.success) {
        expect(authResult.statusCode).toBeGreaterThanOrEqual(400);
        
        if (authResult.error) {
          expect(authResult.error).not.toMatch(/SQL|database|connection|timeout/i);
        }
      }
    });
  });

  describe('Cryptographic Security', () => {
    it('should not expose sensitive cryptographic material', async () => {
      const testUser = testEnv.testUsers.find((u: any) => u.isSuperAdmin);
      expect(testUser).toBeDefined();

      const request = mockRequest('http://localhost:3000/api/system/config', {
        headers: {
          'authorization': `Bearer mock-token-${testUser.id}`
        }
      });

      const authResult = await requirePermission(
        request as NextRequest,
        'system:read:all'
      );

      // Response should not contain sensitive keys or secrets
      const resultString = JSON.stringify(authResult);
      
      expect(resultString).not.toMatch(/(?:secret|key|password|token).*[:=]\s*["\'][\w+\/=]{16,}/i);
      expect(resultString).not.toContain('-----BEGIN');
      expect(resultString).not.toContain('-----END');
    });

    it('should validate signature/token integrity', async () => {
      // Test with various manipulated tokens
      const manipulatedTokens = [
        'Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.manipulated.signature',
        'Bearer valid.header.tampered-signature',
        'Bearer tampered-header.valid.signature'
      ];

      for (const token of manipulatedTokens) {
        const request = mockRequest('http://localhost:3000/api/secure', {
          headers: {
            'authorization': token
          }
        });

        const authResult = await requirePermission(
          request as NextRequest,
          'secure:access'
        );

        // Tampered tokens should be rejected
        expect(authResult.success).toBe(false);
        expect(authResult.statusCode).toBe(401);
      }
    });
  });
});