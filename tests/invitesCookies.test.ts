// @ts-nocheck
// Test: invite route rejects requests without auth and accepts authenticated requests
import { NextRequest } from 'next/server';
import { POST as invitesPOST } from '@/app/api/tenants/[tenantId]/invites/route';

const inserted: Array<Record<string, unknown>> = [];

jest.mock('@/lib/supabase/server', () => ({
  createSupabaseAdminClient: jest.fn(() => ({
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user: { id: 'u1', email: 'u1@example.com' } },
        error: null,
      }),
    },
    from: jest.fn().mockImplementation((table: string) => {
      if (table === 'tenant_users') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({
            data: { tenant_id: 't1', role: 'manager' },
            error: null,
          }),
        };
      }
      if (table === 'tenants') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({
            data: { lifecycle_state: 'active' },
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
  })),
}));

jest.mock('@/lib/supabase/bearer-client', () => ({
  createSupabaseBearerClient: jest.fn().mockImplementation(() => ({
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user: { id: 'u1', email: 'u1@example.com' } },
        error: null,
      }),
    },
    from: jest.fn().mockImplementation((table: string) => {
      if (table === 'tenant_users') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({ data: { role: 'manager' }, error: null }),
          maybeSingle: jest.fn().mockResolvedValue({
            data: { tenant_id: 't1', role: 'manager' },
            error: null,
          }),
          then: (resolve: (value: unknown) => void) =>
            resolve({ data: [{ tenant_id: 't1', role: 'manager' }], error: null }),
        };
      }
      if (table === 'tenants') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({
            data: { settings: { allowedInviterRoles: ['manager'], allowInvitesFromStaffPage: true } },
            error: null,
          }),
        };
      }
      if (table === 'invites') {
        return {
          insert: jest.fn().mockImplementation((row: Record<string, unknown>) => {
            inserted.push(row);
            return Promise.resolve({ error: null });
          }),
        };
      }
      return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis() };
    }),
  })),
}));

describe('Invites API auth path', () => {
  beforeEach(() => { inserted.length = 0; });

  it('rejects request without auth', async () => {
    const req = new NextRequest('http://x/api/tenants/t1/invites', {
      method: 'POST',
      headers: { 'x-test-bypass-skip': '1' },
      body: JSON.stringify({ email: 'a@b.com' })
    });
    const res: Response = await invitesPOST(req, { params: { tenantId: 't1' } });
    expect(res.status).toBe(401);
  });

  it('accepts authenticated request with manager role', async () => {
    const req = new NextRequest('http://x/api/tenants/t1/invites', {
      method: 'POST',
      headers: { 'authorization': 'Bearer test-token', 'x-tenant-id': 't1' },
      body: JSON.stringify({ email: 'staff@example.com' })
    });
    const res: Response = await invitesPOST(req, { params: { tenantId: 't1' } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty('ok', true);
    expect(json).toHaveProperty('url');
  });
});
