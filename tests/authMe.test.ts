// @ts-nocheck
// Jest globals are available without import
import { NextRequest } from 'next/server';
import { GET as authMeGET } from '@/app/api/auth/me/route';

// Supabase stub — returns mock data for users and tenant_users
function makeSupabase() {
  const tenantUsers = [
    { user_id: 'u1', tenant_id: 't1', role: 'owner' },
    { user_id: 'u1', tenant_id: 't2', role: 'staff' }
  ];

  function makeTable() {
    const self = {
      _userId: undefined as string | undefined,
      _tenantId: undefined as string | undefined,
      select() { return self; },
      eq(_col: string, val: string) {
        if (_col === 'user_id') self._userId = val;
        if (_col === 'tenant_id') self._tenantId = val;
        return self;
      },
      maybeSingle() {
        const match = tenantUsers.find(
          tu => tu.user_id === self._userId && tu.tenant_id === self._tenantId
        );
        return Promise.resolve({ data: match || null, error: null });
      },
      // Make chain thenable for array queries like .from().select().eq() without .single()
      then(resolve: (v: unknown) => void) {
        const matches = self._userId
          ? tenantUsers.filter(tu => tu.user_id === self._userId)
          : [];
        resolve({ data: matches, error: null });
      }
    };
    return self;
  }

  return {
    from() { return makeTable(); },
    auth: {
      getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'u1', email: 'owner@example.com' } }, error: null }),
    },
    rpc: jest.fn().mockResolvedValue({ data: null, error: null }),
  };
}

// Mock the bearer client so our stub is used when the route creates a Supabase client
jest.mock('@/lib/supabase/bearer-client', () => ({
  createSupabaseBearerClient: jest.fn().mockImplementation(() => makeSupabase()),
}));

jest.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: jest.fn().mockImplementation(() => makeSupabase()),
  getSupabaseRouteHandlerClient: jest.fn().mockImplementation(() => makeSupabase()),
  // auth:true routes verify the JWT + tenant membership via the admin client.
  createSupabaseAdminClient: jest.fn().mockImplementation(() => makeSupabase()),
}));

describe('auth/me API route', () => {
  it('returns 401 without auth header', async () => {
    const res: any = await authMeGET(new NextRequest('http://x/api/auth/me', { headers: { 'x-test-bypass-skip': '1' } }));
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json).toHaveProperty('error');
  });

  it('returns identity with highest role', async () => {
    const req = new NextRequest('http://x/api/auth/me', {
      headers: {
        'Authorization': 'Bearer fake-test-token',
        'x-tenant-id': 't1',
      }
    });
    const res: any = await authMeGET(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ userId: 'u1', role: 'owner', tenantId: 't1' });
    expect(Array.isArray(json.tenantRoles)).toBe(true);
  });
});
