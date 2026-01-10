/**
 * Test setup for individual permission test suites
 * 
 * This file runs before each test file and sets up test-specific utilities.
 */

import { jest } from '@jest/globals';
import { setupTestEnvironment, type TestEnvironment } from '@/types/permission-testing-framework';

declare global {
  var testEnvironment: TestEnvironment | undefined;
}

// Extend Jest matchers for permission testing
expect.extend({
  toHavePermission(received: boolean, permission: string) {
    const pass = received === true;
    
    if (pass) {
      return {
        message: () => `Expected user NOT to have permission "${permission}"`,
        pass: true,
      };
    } else {
      return {
        message: () => `Expected user to have permission "${permission}"`,
        pass: false,
      };
    }
  },

  toBeSecurelyDenied(received: any, reason?: string) {
    const hasSecurityReason = received?.reason && received.reason.includes('security');
    const isProperlyDenied = received?.granted === false;
    const hasAuditFlag = received?.auditRequired === true;
    
    const pass = isProperlyDenied && (hasSecurityReason || hasAuditFlag);
    
    if (pass) {
      return {
        message: () => `Expected access NOT to be securely denied`,
        pass: true,
      };
    } else {
      return {
        message: () => `Expected access to be securely denied with proper audit trail`,
        pass: false,
      };
    }
  },

  toRespectTenantIsolation(received: any, expectedTenantId: string) {
    const isDenied = received?.granted === false;
    const hasTenantReason = received?.reason && received.reason.toLowerCase().includes('tenant');
    
    const pass = isDenied && hasTenantReason;
    
    if (pass) {
      return {
        message: () => `Expected access NOT to respect tenant isolation for tenant "${expectedTenantId}"`,
        pass: true,
      };
    } else {
      return {
        message: () => `Expected access to respect tenant isolation for tenant "${expectedTenantId}"`,
        pass: false,
      };
    }
  }
});

// Setup test environment before each test file
beforeEach(async () => {
  if (!global.testEnvironment) {
    global.testEnvironment = await setupTestEnvironment();
  }
});

// Cleanup after each test file
afterEach(async () => {
  // Reset any mocks or spies
  jest.clearAllMocks();
});

// Global cleanup
afterAll(async () => {
  if (global.testEnvironment) {
    await global.testEnvironment.cleanup();
    global.testEnvironment = undefined;
  }
});

// Export test utilities
export function getTestEnvironment(): TestEnvironment {
  if (!global.testEnvironment) {
    throw new Error('Test environment not initialized. Run setupTestEnvironment() first.');
  }
  return global.testEnvironment;
}

// Mock helpers for testing
export const mockRequest = (url: string, options: {
  method?: string;
  headers?: Record<string, string>;
  body?: any;
} = {}) => {
  const { method = 'GET', headers = {}, body } = options;
  
  return new Request(url, {
    method,
    headers: {
      'content-type': 'application/json',
      ...headers
    },
    body: body ? JSON.stringify(body) : undefined
  });
};

export const mockUser = (overrides: Partial<{
  id: string;
  role: string;
  tenantId: string;
  isSuperAdmin: boolean;
}> = {}) => ({
  id: 'test-user-id',
  role: 'staff',
  tenantId: 'test-tenant-id',
  isSuperAdmin: false,
  email: 'test@example.com',
  permissions: [],
  effectivePermissions: [],
  ...overrides
});

// Type extensions for Jest
declare global {
  namespace jest {
    interface Matchers<R> {
      toHavePermission(permission: string): R;
      toBeSecurelyDenied(reason?: string): R;
      toRespectTenantIsolation(expectedTenantId: string): R;
    }
  }
}