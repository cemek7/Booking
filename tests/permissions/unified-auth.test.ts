// @ts-nocheck
/**
 * Integration tests for the unified API route handler authentication.
 * Tests auth enforcement in createApiHandler / createHttpHandler.
 */

import { describe, it, expect } from '@jest/globals';
import { createApiHandler } from '@/lib/error-handling/route-handler';
import { NextRequest } from 'next/server';
import { createSupabaseBearerClient } from '@/lib/supabase/bearer-client';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { BOOKA_PERMISSIONS } from '@/types/permissions';
import { getEffectivePermissions } from '@/lib/permissions/effectivePermissions';

jest.mock('@/lib/permissions/effectivePermissions', () => ({
  getEffectivePermissions: jest.fn(),
}));

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

const approveAnomalyHandler = createApiHandler(
  async () => ({ ok: true }),
  { auth: true, roles: ['owner', 'manager'], permissions: [BOOKA_PERMISSIONS.APPROVE_ANOMALIES] }
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
            data: { id: 'tenant-user-1', tenant_id: tenantId, role },
            error: null,
          }),
          then: (resolve: any) =>
            resolve({ data: [{ id: 'tenant-user-1', tenant_id: tenantId, role }], error: null }),
        };
      }
      if (table === 'business_events') {
        return {
          insert: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({
            data: {
              tenant_id: tenantId,
              action: 'access.denied',
              entity_type: 'api_route',
              entity_id: '/api/test',
              created_at: new Date().toISOString(),
            },
            error: null,
          }),
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
  // Reset both clients to the default authenticated owner before each test so a
  // persistent per-test role override (mockReturnValue) cannot leak into the next.
  beforeEach(() => {
    (createSupabaseAdminClient as jest.Mock).mockReturnValue(makeBearerClient('owner'));
    (createSupabaseBearerClient as jest.Mock).mockReturnValue(makeBearerClient('owner'));
    (getEffectivePermissions as jest.Mock).mockResolvedValue([BOOKA_PERMISSIONS.APPROVE_ANOMALIES]);
  });

  describe('Basic Authentication Flow', () => {
    it('should authenticate valid users (global bearer mock defaults to owner)', async () => {
      // TestRequest wrapper injects Bearer test-token + x-tenant-id: test-tenant-id
      const req = new NextRequest('http://localhost:3000/api/test');
      const res: any = await echoHandler(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.userId).toBe('test-user-id');
      expect(json.role).toBe('owner');
      expect(json.tenantId).toBe('test-tenant-id');
    });

    it('should reject unauthenticated requests', async () => {
      const req = new NextRequest('http://localhost:3000/api/test', {
        headers: { 'x-test-bypass-skip': '1' }
      });
      const res: any = await echoHandler(req);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBeDefined();
    });

    it('should inject auth headers automatically (TestRequest wrapper)', async () => {
      const req = new NextRequest('http://localhost:3000/api/test');
      const res: any = await echoHandler(req);
      expect(res.status).toBe(200);
    });
  });

  describe('Role-Based Authentication', () => {
    it('should allow owner to access owner-only routes', async () => {
      // Global mock returns 'owner' — no override needed
      const req = new NextRequest('http://x/api/test');
      const res: any = await ownerOnlyHandler(req);
      expect(res.status).toBe(200);
    });

    it('should deny staff access to owner-only routes', async () => {
      // Role is resolved from the admin client (membership check), so override it too.
      (createSupabaseBearerClient as jest.Mock).mockReturnValueOnce(
        makeBearerClient('staff')
      );
      (createSupabaseAdminClient as jest.Mock).mockReturnValue(
        makeBearerClient('staff')
      );
      const req = new NextRequest('http://x/api/test', {
        headers: { 'authorization': 'Bearer test-token', 'x-tenant-id': 'test-tenant-id' }
      });
      const res: any = await ownerOnlyHandler(req);
      expect(res.status).toBe(403);
    });

    it('should allow manager to access manager-or-owner routes', async () => {
      (createSupabaseBearerClient as jest.Mock).mockReturnValueOnce(
        makeBearerClient('manager')
      );
      const req = new NextRequest('http://x/api/test', {
        headers: { 'authorization': 'Bearer test-token', 'x-tenant-id': 'test-tenant-id' }
      });
      const res: any = await managerOrOwnerHandler(req);
      expect(res.status).toBe(200);
    });

    it('should deny staff access to manager-or-owner routes', async () => {
      // Role is resolved from the admin client (membership check), so override it too.
      (createSupabaseBearerClient as jest.Mock).mockReturnValueOnce(
        makeBearerClient('staff')
      );
      (createSupabaseAdminClient as jest.Mock).mockReturnValue(
        makeBearerClient('staff')
      );
      const req = new NextRequest('http://x/api/test', {
        headers: { 'authorization': 'Bearer test-token', 'x-tenant-id': 'test-tenant-id' }
      });
      const res: any = await managerOrOwnerHandler(req);
      expect(res.status).toBe(403);
    });

    it('should allow a manager with the required effective permission', async () => {
      (createSupabaseBearerClient as jest.Mock).mockReturnValueOnce(
        makeBearerClient('manager')
      );
      (createSupabaseAdminClient as jest.Mock).mockReturnValue(
        makeBearerClient('manager')
      );
      (getEffectivePermissions as jest.Mock).mockResolvedValueOnce([BOOKA_PERMISSIONS.APPROVE_ANOMALIES]);

      const req = new NextRequest('http://x/api/test', {
        headers: { 'authorization': 'Bearer test-token', 'x-tenant-id': 'test-tenant-id' }
      });
      const res: any = await approveAnomalyHandler(req);
      expect(res.status).toBe(200);
    });

    it('should deny a manager missing the required effective permission', async () => {
      (createSupabaseBearerClient as jest.Mock).mockReturnValueOnce(
        makeBearerClient('manager')
      );
      (createSupabaseAdminClient as jest.Mock).mockReturnValue(
        makeBearerClient('manager')
      );
      (getEffectivePermissions as jest.Mock).mockResolvedValueOnce([]);

      const req = new NextRequest('http://x/api/test', {
        headers: { 'authorization': 'Bearer test-token', 'x-tenant-id': 'test-tenant-id' }
      });
      const res: any = await approveAnomalyHandler(req);
      expect(res.status).toBe(403);
    });
  });

  describe('Tenant Isolation', () => {
    it('should pass tenant context through to route handler', async () => {
      (createSupabaseBearerClient as jest.Mock).mockReturnValueOnce(
        makeBearerClient('owner', 'my-tenant')
      );
      (createSupabaseAdminClient as jest.Mock).mockReturnValue(
        makeBearerClient('owner', 'my-tenant')
      );
      const req = new NextRequest('http://x/api/test', {
        headers: { 'authorization': 'Bearer test-token', 'x-tenant-id': 'my-tenant' }
      });
      const res: any = await echoHandler(req);
      const json = await res.json();
      expect(json.tenantId).toBe('my-tenant');
    });
  });

  describe('Error Response Format', () => {
    it('should return 401 with error field for unauthenticated', async () => {
      const req = new NextRequest('http://x/api/test', {
        headers: { 'x-test-bypass-skip': '1' }
      });
      const res: any = await echoHandler(req);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json).toHaveProperty('error');
    });

    it('should return 403 with error field for unauthorized role', async () => {
      // Role is resolved from the admin client (membership check), so override it too.
      (createSupabaseBearerClient as jest.Mock).mockReturnValueOnce(
        makeBearerClient('staff')
      );
      (createSupabaseAdminClient as jest.Mock).mockReturnValue(
        makeBearerClient('staff')
      );
      const req = new NextRequest('http://x/api/test', {
        headers: { 'authorization': 'Bearer test-token', 'x-tenant-id': 'test-tenant-id' }
      });
      const res: any = await ownerOnlyHandler(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json).toHaveProperty('error');
    });
  });
});
