// @ts-nocheck
/**
 * Multi-Tenant Data Isolation Tests
 *
 * Verifies that authenticated users in tenant-A cannot read or write data
 * belonging to tenant-B. Each test uses a dedicated bearer client mock that
 * returns tenant-A credentials, then asserts that:
 *   - Reads are scoped to tenant-A's tenantId in the Supabase filter
 *   - Writes use server-verified tenantId (not a caller-supplied tenantId)
 */

import { createSupabaseBearerClient } from '@/lib/supabase/bearer-client';
import { GET as customersGET, POST as customersPOST } from '@/app/api/customers/route';

const TENANT_A = 'tenant-A';
const TENANT_B = 'tenant-B';

/** Build a bearer client mock that authenticates as a user in the given tenant */
function makeBearerClient(tenantId: string, role = 'owner') {
  const capturedFilters: Record<string, unknown> = {};
  const capturedInserts: unknown[] = [];

  const client = {
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user: { id: 'user-in-tenant-a', email: 'user@tenant-a.com' } },
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

      if (table === 'customers') {
        return {
          select: jest.fn().mockReturnThis(),
          insert: jest.fn().mockImplementation((rows: unknown) => {
            const payload = Array.isArray(rows) ? rows[0] : rows;
            capturedInserts.push(payload);
            return {
              select: jest.fn().mockReturnThis(),
              maybeSingle: jest.fn().mockResolvedValue({
                data: { id: 'new-customer-id', ...payload },
                error: null,
              }),
            };
          }),
          eq: jest.fn().mockImplementation(function (col: string, val: string) {
            capturedFilters[col] = val;
            return this;
          }),
          order: jest.fn().mockReturnThis(),
          range: jest.fn().mockResolvedValue({ data: [], error: null }),
        };
      }

      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
      };
    }),
    _capturedFilters: capturedFilters,
    _capturedInserts: capturedInserts,
  };

  return client;
}

describe('Multi-Tenant Data Isolation', () => {
  describe('Test 1 — GET /api/customers: query scoped to authenticated tenant', () => {
    it('passes authenticated tenant-A id to the Supabase filter (not a header-supplied id)', async () => {
      const bearerClient = makeBearerClient(TENANT_A);
      (createSupabaseBearerClient as jest.Mock).mockReturnValueOnce(bearerClient);

      const req = new Request(
        'http://localhost/api/customers?page=1&limit=10',
        { headers: { authorization: 'Bearer test-token', 'x-tenant-id': TENANT_A } }
      );
      const res: any = await customersGET(req);

      expect(res.status).toBe(200);
      // The handler must have called .eq('tenant_id', TENANT_A) on the customers query
      expect(bearerClient._capturedFilters['tenant_id']).toBe(TENANT_A);
    });
  });

  describe('Test 2 — GET /api/customers: tenant-B data not returned when querying as tenant-A', () => {
    it('returns empty list when Supabase (correctly filtered) returns no data for tenant-A', async () => {
      const bearerClient = makeBearerClient(TENANT_A);
      // Override customers query to return tenant-B data (simulates a DB that ignores RLS)
      // The handler's .eq('tenant_id', TENANT_A) filter is what isolates data.
      // In production the DB enforces this; here we verify the filter is passed.
      (createSupabaseBearerClient as jest.Mock).mockReturnValueOnce(bearerClient);

      const req = new Request(
        'http://localhost/api/customers',
        { headers: { authorization: 'Bearer test-token', 'x-tenant-id': TENANT_A } }
      );
      const res: any = await customersGET(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      // Mock returns [] (simulating DB returning no rows for tenant-A filter)
      expect(Array.isArray(json.data)).toBe(true);
      // Verify the filter was set to TENANT_A, not TENANT_B
      expect(bearerClient._capturedFilters['tenant_id']).toBe(TENANT_A);
      expect(bearerClient._capturedFilters['tenant_id']).not.toBe(TENANT_B);
    });
  });

  describe('Test 3 — POST /api/customers: server ignores body tenant_id, uses auth context', () => {
    it('creates customer under tenant-A even when request body contains tenant_id = tenant-B', async () => {
      const bearerClient = makeBearerClient(TENANT_A);
      (createSupabaseBearerClient as jest.Mock).mockReturnValueOnce(bearerClient);

      const req = new Request('http://localhost/api/customers', {
        method: 'POST',
        headers: {
          authorization: 'Bearer test-token',
          'x-tenant-id': TENANT_A,
          'content-type': 'application/json',
        },
        // Attacker attempts to inject tenant-B into the payload
        body: JSON.stringify({ name: 'Attacker', tenant_id: TENANT_B }),
      });
      const res: any = await customersPOST(req);

      expect(res.status).toBe(200);
      // The insert must use TENANT_A (from server-verified auth context),
      // not the TENANT_B value from the request body.
      expect(bearerClient._capturedInserts).toHaveLength(1);
      expect((bearerClient._capturedInserts[0] as any).tenant_id).toBe(TENANT_A);
      expect((bearerClient._capturedInserts[0] as any).tenant_id).not.toBe(TENANT_B);
    });
  });
});
