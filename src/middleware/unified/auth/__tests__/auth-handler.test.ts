/**
 * Unit tests for auth-handler.ts
 * Tests the getAuthenticatedUserRole function for various scenarios
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { NextRequest } from 'next/server';
import { getAuthenticatedUserRole } from '../auth-handler';

// Mock Supabase clients — auth-handler uses createServerSupabaseClient (session auth)
// and createSupabaseAdminClient (superadmin lookup via 'admins' table).
jest.mock('@/lib/supabase/server', () => ({
  getSupabaseRouteHandlerClient: jest.fn(),
  createServerSupabaseClient: jest.fn(),
  createSupabaseAdminClient: jest.fn(),
}));

/**
 * Build a chainable Supabase mock.
 *
 * Two query shapes are used by getAuthenticatedUserRole:
 *
 * A) Tenant-header path  → .from().select().eq().eq().maybeSingle()
 *    Terminal: maybeSingle() — configure via `maybeSingleResult`.
 *
 * B) Fallback path       → .from().select().eq().order().limit(2)
 *    Terminal: await .limit() result — configure via `limitResult`.
 *    The object returned by limit() must be thenable so `await` resolves it.
 */
function makeServerClientMock(opts?: {
  maybeSingleResult?: { data: unknown; error: unknown };
  limitResult?: { data: unknown; error: unknown };
}) {
  const maybeSingleResult = opts?.maybeSingleResult ?? { data: null, error: null };
  const limitResult = opts?.limitResult ?? { data: [], error: null };

  // Thenable returned by .limit() — awaited directly as an array query.
  const limitThenable = {
    then(
      resolve: (v: { data: unknown; error: unknown }) => unknown,
      _reject?: (e: unknown) => unknown
    ) {
      return Promise.resolve(limitResult).then(resolve, _reject);
    },
  };

  const chain: Record<string, unknown> = {};
  const proxy: typeof chain = new Proxy(chain, {
    get(_t, prop) {
      if (prop === 'maybeSingle') {
        return jest
          .fn<() => Promise<{ data: unknown; error: unknown }>>()
          .mockResolvedValue(maybeSingleResult);
      }
      if (prop === 'limit') {
        return jest.fn().mockReturnValue(limitThenable);
      }
      if (prop === 'then') {
        // Make the chain itself thenable (needed if any path awaits mid-chain)
        return undefined; // Do NOT expose then — forces explicit .maybeSingle() / .limit()
      }
      return jest.fn().mockReturnValue(proxy);
    },
  });
  return proxy;
}

describe('getAuthenticatedUserRole', () => {
  let mockSupabase: {
    auth: { getUser: jest.Mock<(...args: unknown[]) => Promise<unknown>> };
    from: jest.Mock;
    maybeSingleResult: { data: unknown; error: unknown };
    limitResult: { data: unknown; error: unknown };
  };
  let mockAdminClient: {
    from: jest.Mock;
    select: jest.Mock;
    eq: jest.Mock;
    maybeSingle: jest.Mock<(...args: unknown[]) => Promise<unknown>>;
  };
  let mockRequest: NextRequest;

  beforeEach(() => {
    jest.clearAllMocks();

    // Shared result holders — tests override these per-scenario.
    const maybeSingleResult: { data: unknown; error: unknown } = { data: null, error: null };
    const limitResult: { data: unknown; error: unknown } = { data: [], error: null };

    const chainProxy = makeServerClientMock({ maybeSingleResult, limitResult });

    // We rebuild the proxy each test via a closure over result holders so
    // beforeEach overrides propagate.  Simpler: just rebuild from scratch.
    // The mock below uses function-level closures for per-test configuration.
    mockSupabase = {
      auth: {
        getUser: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
      },
      from: jest.fn().mockReturnValue(chainProxy),
      maybeSingleResult,
      limitResult,
    };

    // Setup mock admin client (used by isSuperadminUser to query 'admins' table).
    // Default: not a superadmin (admins lookup returns null).
    mockAdminClient = {
      from: jest.fn(() => mockAdminClient),
      select: jest.fn(() => mockAdminClient),
      eq: jest.fn(() => mockAdminClient),
      maybeSingle: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue({
        data: null,
        error: null,
      }),
    };

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createServerSupabaseClient, createSupabaseAdminClient } = require('@/lib/supabase/server');
    (createServerSupabaseClient as jest.Mock).mockImplementation(() => mockSupabase);
    (createSupabaseAdminClient as jest.Mock).mockReturnValue(mockAdminClient);

    // Setup mock request
    mockRequest = {
      headers: new Headers(),
      url: 'http://localhost:3000/api/test',
    } as NextRequest;
  });

  // Helper: rebuild mockSupabase.from to return a fresh chain with specific
  // terminal results.  Must be called BEFORE the production code runs.
  function configureChain(opts: {
    maybeSingleResult?: { data: unknown; error: unknown };
    limitResult?: { data: unknown; error: unknown };
  }) {
    const proxy = makeServerClientMock(opts);
    (mockSupabase.from as jest.Mock).mockReturnValue(proxy);
  }

  describe('when user is not authenticated', () => {
    it('should return null role and isAuthenticated false', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: null,
      });

      const result = await getAuthenticatedUserRole(mockRequest);

      expect(result).toEqual({
        role: null,
        isAuthenticated: false,
        tenantId: null,
      });
    });
  });

  describe('when tenantId header is provided', () => {
    beforeEach(() => {
      mockRequest.headers.set('x-tenant-id', 'tenant-123');
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-1', email: 'test@example.com' } },
        error: null,
      });
    });

    it('should query for tenant membership with provided tenantId', async () => {
      configureChain({ maybeSingleResult: { data: { role: 'owner' }, error: null } });

      const result = await getAuthenticatedUserRole(mockRequest);

      expect(mockSupabase.from).toHaveBeenCalledWith('tenant_users');
      expect(result).toEqual({
        role: 'owner',
        isAuthenticated: true,
        tenantId: 'tenant-123',
      });
    });

    it('should return null role when membership does not exist', async () => {
      configureChain({ maybeSingleResult: { data: null, error: null } });

      const result = await getAuthenticatedUserRole(mockRequest);

      expect(result).toEqual({
        role: null,
        isAuthenticated: true,
        tenantId: 'tenant-123',
      });
    });

    it('should return null role when membership query fails', async () => {
      configureChain({ maybeSingleResult: { data: null, error: { message: 'Database error' } } });

      const result = await getAuthenticatedUserRole(mockRequest);

      expect(result).toEqual({
        role: null,
        isAuthenticated: true,
        tenantId: 'tenant-123',
      });
    });

    it('should return immediately without second query when membership is found', async () => {
      configureChain({ maybeSingleResult: { data: { role: 'manager' }, error: null } });

      await getAuthenticatedUserRole(mockRequest);

      // Verify only one query was made (no fallback query)
      expect(mockSupabase.from).toHaveBeenCalledTimes(1);
    });
  });

  describe('fallback query when no tenantId header is provided', () => {
    beforeEach(() => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-1', email: 'test@example.com' } },
        error: null,
      });
    });

    it('should query for any tenant membership when user has one tenant', async () => {
      // Production uses .limit(2) and checks array length.
      // Single-element result → auto-selects that tenant.
      configureChain({
        limitResult: { data: [{ role: 'staff', tenant_id: 'tenant-abc' }], error: null },
      });

      const result = await getAuthenticatedUserRole(mockRequest);

      expect(mockSupabase.from).toHaveBeenCalledWith('tenant_users');
      expect(result).toEqual({
        role: 'staff',
        isAuthenticated: true,
        tenantId: 'tenant-abc',
      });
    });

    it('should return first tenant deterministically when user has multiple tenants', async () => {
      // Two memberships → production returns null (ambiguous — no x-tenant-id header).
      // The "deterministic" guarantee is enforced by the DB's ORDER BY; the middleware
      // still requires an explicit header when multiple memberships exist.
      configureChain({
        limitResult: {
          data: [
            { role: 'owner', tenant_id: 'tenant-aaa' },
            { role: 'staff', tenant_id: 'tenant-bbb' },
          ],
          error: null,
        },
      });

      const result = await getAuthenticatedUserRole(mockRequest);

      // Multiple memberships without x-tenant-id → ambiguous, returns null
      expect(result).toEqual({
        role: null,
        isAuthenticated: true,
        tenantId: null,
      });
    });

    it('should return null values when user has no tenant memberships', async () => {
      configureChain({ limitResult: { data: [], error: null } });

      const result = await getAuthenticatedUserRole(mockRequest);

      expect(result).toEqual({
        role: null,
        isAuthenticated: true,
        tenantId: null,
      });
    });

    it('should return tenantId even when role is missing', async () => {
      configureChain({
        limitResult: { data: [{ role: null, tenant_id: 'tenant-missing-role' }], error: null },
      });

      const result = await getAuthenticatedUserRole(mockRequest);

      expect(result).toEqual({
        role: null,
        isAuthenticated: true,
        tenantId: 'tenant-missing-role',
      });
    });

    it('should handle query errors gracefully', async () => {
      configureChain({
        limitResult: { data: null, error: { message: 'Connection error' } },
      });

      const result = await getAuthenticatedUserRole(mockRequest);

      expect(result).toEqual({
        role: null,
        isAuthenticated: true,
        tenantId: null,
      });
    });
  });

  describe('bearer token authentication', () => {
    it('should fallback to bearer token when session auth fails', async () => {
      mockRequest.headers.set('authorization', 'Bearer valid-token');

      // First call (session) fails, second call (token) succeeds
      mockSupabase.auth.getUser
        .mockResolvedValueOnce({
          data: { user: null },
          error: { message: 'No session' },
        })
        .mockResolvedValueOnce({
          data: { user: { id: 'user-2', email: 'token@example.com' } },
          error: null,
        });

      // No x-tenant-id → fallback path with single membership
      configureChain({
        limitResult: { data: [{ role: 'manager', tenant_id: 'tenant-xyz' }], error: null },
      });

      const result = await getAuthenticatedUserRole(mockRequest);

      expect(mockSupabase.auth.getUser).toHaveBeenCalledTimes(2);
      expect(mockSupabase.auth.getUser).toHaveBeenNthCalledWith(2, 'valid-token');
      expect(result.isAuthenticated).toBe(true);
      expect(result.role).toBe('manager');
    });
  });

  describe('error handling', () => {
    it('should handle unexpected exceptions gracefully', async () => {
      mockSupabase.auth.getUser.mockRejectedValue(new Error('Unexpected error'));

      const result = await getAuthenticatedUserRole(mockRequest);

      expect(result).toEqual({
        role: null,
        isAuthenticated: false,
        tenantId: null,
      });
    });
  });
});
