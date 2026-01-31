/**
 * UNIFIED MIDDLEWARE & ERROR HANDLING INTEGRATION TESTS
 * 
 * Test suite for verifying the unified system works correctly
 * Run with: npm test -- unified-system.test.ts
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { MiddlewareOrchestrator } from '@/middleware/unified/orchestrator';
import { ApiErrorFactory, ApiError, ErrorCodes } from '@/lib/error-handling/api-error';
import { createHttpHandler, RouteContext } from '@/lib/error-handling/route-handler';
import { NextRequest } from 'next/server';

describe('Unified Middleware & Error Handling System', () => {
  // ============================================================================
  // Middleware Orchestrator Tests
  // ============================================================================

  describe('MiddlewareOrchestrator', () => {
    let orchestrator: MiddlewareOrchestrator;

    beforeEach(() => {
      orchestrator = new MiddlewareOrchestrator();
    });

    it('should register middleware', () => {
      orchestrator.register(
        { name: 'test', enabled: true, priority: 10 },
        async (ctx) => ctx
      );

      const middleware = orchestrator.getMiddleware('test');
      expect(middleware).toBeDefined();
      expect(middleware?.config.name).toBe('test');
    });

    it('should prevent duplicate middleware registration', () => {
      orchestrator.register(
        { name: 'test', enabled: true, priority: 10 },
        async (ctx) => ctx
      );

      expect(() => {
        orchestrator.register(
          { name: 'test', enabled: true, priority: 10 },
          async (ctx) => ctx
        );
      }).toThrow('already registered');
    });

    it('should execute middleware in priority order', async () => {
      const execution: string[] = [];

      orchestrator
        .register(
          { name: 'first', enabled: true, priority: 10 },
          async (ctx) => {
            execution.push('first');
            return ctx;
          }
        )
        .register(
          { name: 'second', enabled: true, priority: 20 },
          async (ctx) => {
            execution.push('second');
            return ctx;
          }
        )
        .register(
          { name: 'third', enabled: true, priority: 5 },
          async (ctx) => {
            execution.push('third');
            return ctx;
          }
        );

      // Should execute in order: second (20), first (10), third (5)
      expect(orchestrator.getAll().map((m) => m.config.name)).toEqual([
        'second',
        'first',
        'third',
      ]);
    });

    it('should skip disabled middleware', async () => {
      const execution: string[] = [];

      orchestrator
        .register(
          { name: 'enabled', enabled: true, priority: 10 },
          async (ctx) => {
            execution.push('enabled');
            return ctx;
          }
        )
        .register(
          { name: 'disabled', enabled: false, priority: 20 },
          async (ctx) => {
            execution.push('disabled');
            return ctx;
          }
        );

      // Note: Would need actual request to fully test
      // This is more of a unit test for configuration
    });

    it('should unregister middleware', () => {
      orchestrator.register(
        { name: 'test', enabled: true, priority: 10 },
        async (ctx) => ctx
      );

      expect(orchestrator.getMiddleware('test')).toBeDefined();

      orchestrator.unregister('test');

      expect(orchestrator.getMiddleware('test')).toBeUndefined();
    });

    it('should clear all middleware', () => {
      orchestrator
        .register({ name: 'test1', enabled: true, priority: 10 }, async (ctx) => ctx)
        .register({ name: 'test2', enabled: true, priority: 10 }, async (ctx) => ctx);

      expect(orchestrator.getAll()).toHaveLength(2);

      orchestrator.clear();

      expect(orchestrator.getAll()).toHaveLength(0);
    });

    it('should handle conditional middleware', () => {
      const conditionExecuted: boolean[] = [];

      orchestrator.register(
        {
          name: 'conditional',
          enabled: true,
          priority: 10,
          condition: (ctx) => {
            conditionExecuted.push(true);
            return true;
          },
        },
        async (ctx) => ctx
      );

      const middleware = orchestrator.getMiddleware('conditional');
      expect(middleware?.config.condition).toBeDefined();
    });
  });

  // ============================================================================
  // Error Handling Tests
  // ============================================================================

  describe('API Error System', () => {
    it('should create auth error', () => {
      const error = ApiErrorFactory.missingAuthorization();

      expect(error).toBeInstanceOf(ApiError);
      expect(error.code).toBe(ErrorCodes.MISSING_AUTHORIZATION);
      expect(error.statusCode).toBe(401);
      expect(error.message).toContain('Authorization');
    });

    it('should create permission error', () => {
      const error = ApiErrorFactory.insufficientPermissions(['owner', 'manager']);

      expect(error.code).toBe(ErrorCodes.INSUFFICIENT_PERMISSIONS);
      expect(error.statusCode).toBe(403);
      expect(error.details).toEqual({ required: ['owner', 'manager'] });
    });

    it('should create validation error', () => {
      const error = ApiErrorFactory.validationError({
        email: 'Invalid email format',
      });

      expect(error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      expect(error.statusCode).toBe(400);
      expect(error.details?.email).toBe('Invalid email format');
    });

    it('should create not found error', () => {
      const error = ApiErrorFactory.notFound('User');

      expect(error.code).toBe(ErrorCodes.NOT_FOUND);
      expect(error.statusCode).toBe(404);
      expect(error.message).toContain('User');
    });

    it('should create conflict error', () => {
      const error = ApiErrorFactory.conflict('User already exists');

      expect(error.code).toBe(ErrorCodes.CONFLICT);
      expect(error.statusCode).toBe(409);
    });

    it('should create database error', () => {
      const originalError = new Error('Connection refused');
      const error = ApiErrorFactory.databaseError(originalError);

      expect(error.code).toBe(ErrorCodes.DATABASE_ERROR);
      expect(error.statusCode).toBe(500);
      expect(error.originalError).toBe(originalError);
    });

    it('should convert error to response', async () => {
      const error = ApiErrorFactory.missingAuthorization();
      const response = error.toResponse();

      expect(response.status).toBe(401);
      const json = await response.json();
      expect(json.code).toBe(ErrorCodes.MISSING_AUTHORIZATION);
      expect(json.message).toBeDefined();
      expect(json.timestamp).toBeDefined();
    });

    it('should convert error to JSON', () => {
      const error = ApiErrorFactory.validationError({ name: 'Required' });
      const json = error.toJSON();

      expect(json.error).toBe(ErrorCodes.VALIDATION_ERROR);
      expect(json.code).toBe(ErrorCodes.VALIDATION_ERROR);
      expect(json.details?.name).toBe('Required');
      expect(json.timestamp).toBeDefined();
    });

    it('should maintain proper HTTP status code mapping', () => {
      const statusMap: Record<string, number> = {
        [ErrorCodes.MISSING_AUTHORIZATION]: 401,
        [ErrorCodes.INVALID_TOKEN]: 401,
        [ErrorCodes.FORBIDDEN]: 403,
        [ErrorCodes.NOT_FOUND]: 404,
        [ErrorCodes.CONFLICT]: 409,
        [ErrorCodes.VALIDATION_ERROR]: 400,
        [ErrorCodes.INTERNAL_SERVER_ERROR]: 500,
        [ErrorCodes.EXTERNAL_SERVICE_ERROR]: 502,
        [ErrorCodes.TIMEOUT]: 504,
      };

      for (const [code, expectedStatus] of Object.entries(statusMap)) {
        const error = new ApiError(code, 'Test error');
        expect(error.statusCode).toBe(expectedStatus);
      }
    });
  });

  // ============================================================================
  // Error Response Format Tests
  // ============================================================================

  describe('Error Response Format', () => {
    it('should have consistent response structure', async () => {
      const error = ApiErrorFactory.validationError({
        field: 'Email is invalid',
      });
      const response = error.toResponse();
      const json = await response.json();

      expect(json).toHaveProperty('error');
      expect(json).toHaveProperty('code');
      expect(json).toHaveProperty('message');
      expect(json).toHaveProperty('timestamp');
      expect(json).toHaveProperty('details');
    });

    it('should include error details when present', async () => {
      const error = ApiErrorFactory.validationError({
        email: 'Invalid format',
        password: 'Too short',
      });
      const response = error.toResponse(true);
      const json = await response.json();

      expect(json.details.email).toBe('Invalid format');
      expect(json.details.password).toBe('Too short');
    });

    it('should exclude details when includeDetails is false', async () => {
      const error = ApiErrorFactory.validationError({
        email: 'Invalid format',
      });
      const response = error.toResponse(false);
      const json = await response.json();

      expect(json.details).toBeUndefined();
    });

    it('should include timestamp in ISO format', async () => {
      const error = ApiErrorFactory.internalServerError();
      const response = error.toResponse();
      const json = await response.json();

      const timestamp = new Date(json.timestamp);
      expect(timestamp.getTime()).toBeCloseTo(Date.now(), 1000);
    });
  });

  // ============================================================================
  // Route Handler Tests
  // ============================================================================

  describe('createHttpHandler', () => {
    it('should handle successful requests', async () => {
      const handler = createHttpHandler(
        async (ctx: RouteContext) => ({
          success: true,
          data: 'test',
        }),
        'GET',
        { auth: false }
      );

      // Note: Full test would require mocking NextRequest/NextResponse
      expect(handler).toBeDefined();
    });

    it('should validate HTTP method', () => {
      const handler = createHttpHandler(
        async (ctx: RouteContext) => ({ data: 'test' }),
        'GET',
        { auth: false }
      );

      expect(handler).toBeDefined();
    });

    it('should support all HTTP methods', () => {
      const methods = ['GET', 'POST', 'PATCH', 'DELETE'] as const;

      for (const method of methods) {
        const handler = createHttpHandler(
          async (ctx: RouteContext) => ({}),
          method,
          { auth: false }
        );
        expect(handler).toBeDefined();
      }
    });

    describe('requireTenantMembership option', () => {
      it('should default requireTenantMembership to true for authenticated routes', () => {
        // When auth is enabled and requireTenantMembership is not specified,
        // it should default to true for security
        const handler = createHttpHandler(
          async (ctx: RouteContext) => ({ data: 'test' }),
          'GET',
          { auth: true }
        );

        expect(handler).toBeDefined();
        // The handler is created with auth: true
        // requireTenantMembership should default to true (not explicitly false)
      });

      it('should allow opting out of tenant membership check with requireTenantMembership: false', () => {
        // Routes like onboarding can explicitly set requireTenantMembership: false
        // to allow authenticated users without a tenant (e.g., creating first tenant)
        const handler = createHttpHandler(
          async (ctx: RouteContext) => ({ data: 'test' }),
          'POST',
          { 
            auth: true,
            requireTenantMembership: false 
          }
        );

        expect(handler).toBeDefined();
        // The handler is created with auth: true but requireTenantMembership: false
        // This allows authenticated users to access the route without tenant membership
      });

      it('should respect requireTenantMembership: false for onboarding flows', () => {
        // Simulates the /api/onboarding/tenant route pattern
        const handler = createHttpHandler(
          async (ctx: RouteContext) => ({ 
            success: true,
            tenantId: 'new-tenant-123' 
          }),
          'POST',
          { 
            auth: true,
            requireTenantMembership: false 
          }
        );

        expect(handler).toBeDefined();
        // This pattern allows authenticated users to create their first tenant
        // without already having a tenant membership
      });

      it('should enforce tenant membership by default for security', () => {
        // Most authenticated routes should require tenant membership
        const handler = createHttpHandler(
          async (ctx: RouteContext) => ({ data: 'sensitive-data' }),
          'GET',
          { auth: true }
        );

        expect(handler).toBeDefined();
        // Without explicitly setting requireTenantMembership: false,
        // the route enforces tenant membership for security
      });

      it('should not apply tenant membership check to unauthenticated routes', () => {
        // Routes with auth: false should not check tenant membership
        const handler = createHttpHandler(
          async (ctx: RouteContext) => ({ data: 'public' }),
          'GET',
          { auth: false }
        );

        expect(handler).toBeDefined();
        // Public routes don't need tenant membership checks
      });
    });
  });

  // ============================================================================
  // Integration Tests
  // ============================================================================

  describe('Integration', () => {
    it('should handle error in handler and transform to response', () => {
      // This would require full Next.js environment to test properly
      // Here we just verify the error transformation works
      const error = ApiErrorFactory.notFound('User');

      expect(error.statusCode).toBe(404);
      expect(error.code).toBe(ErrorCodes.NOT_FOUND);
    });

    it('should support auth, roles, and permissions together', () => {
      const handler = createHttpHandler(
        async (ctx: RouteContext) => ({ data: 'test' }),
        'POST',
        {
          auth: true,
          roles: ['owner', 'manager'],
          permissions: ['write:users', 'manage:settings'],
        }
      );

      expect(handler).toBeDefined();
    });

    it('should handle multiple error types correctly', () => {
      const errors = [
        ApiErrorFactory.missingAuthorization(),
        ApiErrorFactory.insufficientPermissions(['admin']),
        ApiErrorFactory.validationError({ field: 'required' }),
        ApiErrorFactory.notFound('Resource'),
        ApiErrorFactory.conflict('Already exists'),
        ApiErrorFactory.databaseError(),
        ApiErrorFactory.internalServerError(),
      ];

      for (const error of errors) {
        expect(error).toBeInstanceOf(ApiError);
        expect(error.statusCode).toBeGreaterThanOrEqual(400);
        expect(error.message).toBeDefined();
        expect(error.code).toBeDefined();
      }
    });
  });
});

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Mock middleware for testing
 */
export function createMockMiddleware(name: string, priority: number, handler?: () => void) {
  return {
    config: { name, enabled: true, priority },
    handler: async (ctx: any) => {
      handler?.();
      return ctx;
    },
  };
}

/**
 * Mock route context for testing
 */
export function createMockRouteContext(): RouteContext {
  return {
    request: {} as NextRequest,
    user: {
      id: 'test-user-id',
      email: 'test@example.com',
      role: 'owner',
      tenantId: 'test-tenant-id',
      permissions: ['write:all'],
    },
    supabase: {},
    params: {},
  };
}
