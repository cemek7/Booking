// @ts-nocheck
/**
 * Integration tests for the unified API route handler authentication.
 * Tests auth enforcement in createApiHandler / createHttpHandler.
 */

import { describe, it, expect } from '@jest/globals';
import { createApiHandler } from '@/lib/error-handling/route-handler';
import { createSupabaseBearerClient } from '@/lib/supabase/bearer-client';

// Simple echo handler used in tests
const echoHandler = createApiHandler(
  async (ctx) => ({ userId: ctx.user?.id, role: ctx.user?.role, tenantId: ctx.user?.tenantId }),
  { auth: true }
);

const ownerOnlyHandler = createApiHandler(
  async (ctx) => ({ ok: true }),
  { auth: true, roles: ['owner'] }
);

const managerOrOwnerHandler = createApiHandler(
  async (ctx) => ({ ok: true }),
  { auth: true, roles: ['owner', 'manager'] }
);

/** Helper: build a bearer client mock returning a specific role and tenantId */
function makeBearerClient(role: string, tenantId = 'test-tenant-id', userId = 'test-user-id') {
  return {
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user: { id: userId, email: `${userId}@example.com` } },
        error: null,
      }),
    },
    from: jest.fn().mockImplementation((table: string) => {
      if (table === 'tenant_users') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({
            data: { tenant_id: tenantId, role },
            error: null,
          }),
          then: (resolve: any) =>
            resolve({ data: [{ tenant_id: tenantId, role }], error: null }),
        };
      }
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
      };
    }),
  };
}

describe('Unified Authentication System - Integration Tests', () => {
  describe('Basic Authentication Flow', () => {
    it('should authenticate valid users (global bearer mock defaults to owner)', async () => {
      // TestRequest wrapper injects Bearer test-token + x-tenant-id: test-tenant-id
      const req = new Request('http://localhost:3000/api/test');
      const res: any = await echoHandler(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.userId).toBe('test-user-id');
      expect(json.role).toBe('owner');
      expect(json.tenantId).toBe('test-tenant-id');
    });

    it('should reject unauthenticated requests', async () => {
      const req = new Request('http://localhost:3000/api/test', {
        headers: { 'x-test-bypass-skip': '1' }
      });
      const res: any = await echoHandler(req);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBeDefined();
    });

    it('should inject auth headers automatically (TestRequest wrapper)', async () => {
      const req = new Request('http://localhost:3000/api/test');
      const res: any = await echoHandler(req);
      expect(res.status).toBe(200);
    });
  });

  describe('Role-Based Authentication', () => {
    it('should allow owner to access owner-only routes', async () => {
      // Global mock returns 'owner' — no override needed
      const req = new Request('http://x/api/test');
      const res: any = await ownerOnlyHandler(req);
      expect(res.status).toBe(200);
    });

    it('should deny staff access to owner-only routes', async () => {
      (createSupabaseBearerClient as jest.Mock).mockReturnValueOnce(
        makeBearerClient('staff')
      );
      const req = new Request('http://x/api/test', {
        headers: { 'authorization': 'Bearer test-token', 'x-tenant-id': 'test-tenant-id' }
      });
      const res: any = await ownerOnlyHandler(req);
      expect(res.status).toBe(403);
    });

    it('should allow manager to access manager-or-owner routes', async () => {
      (createSupabaseBearerClient as jest.Mock).mockReturnValueOnce(
        makeBearerClient('manager')
      );
      const req = new Request('http://x/api/test', {
        headers: { 'authorization': 'Bearer test-token', 'x-tenant-id': 'test-tenant-id' }
      });
      const res: any = await managerOrOwnerHandler(req);
      expect(res.status).toBe(200);
    });

    it('should deny staff access to manager-or-owner routes', async () => {
      (createSupabaseBearerClient as jest.Mock).mockReturnValueOnce(
        makeBearerClient('staff')
      );
      const req = new Request('http://x/api/test', {
        headers: { 'authorization': 'Bearer test-token', 'x-tenant-id': 'test-tenant-id' }
      });
      const res: any = await managerOrOwnerHandler(req);
      expect(res.status).toBe(403);
    });
  });

  describe('Tenant Isolation', () => {
    it('should pass tenant context through to route handler', async () => {
      (createSupabaseBearerClient as jest.Mock).mockReturnValueOnce(
        makeBearerClient('owner', 'my-tenant')
      );
      const req = new Request('http://x/api/test', {
        headers: { 'authorization': 'Bearer test-token', 'x-tenant-id': 'my-tenant' }
      });
      const res: any = await echoHandler(req);
      const json = await res.json();
      expect(json.tenantId).toBe('my-tenant');
    });
  });

  describe('Error Response Format', () => {
    it('should return 401 with error field for unauthenticated', async () => {
      const req = new Request('http://x/api/test', {
        headers: { 'x-test-bypass-skip': '1' }
      });
      const res: any = await echoHandler(req);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json).toHaveProperty('error');
    });

    it('should return 403 with error field for unauthorized role', async () => {
      (createSupabaseBearerClient as jest.Mock).mockReturnValueOnce(
        makeBearerClient('staff')
      );
      const req = new Request('http://x/api/test', {
        headers: { 'authorization': 'Bearer test-token', 'x-tenant-id': 'test-tenant-id' }
      });
      const res: any = await ownerOnlyHandler(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json).toHaveProperty('error');
    });
  });
});
