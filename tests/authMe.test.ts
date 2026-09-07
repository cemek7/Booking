// @ts-nocheck
// Jest globals are available without import
import { NextRequest } from 'next/server';
import { GET as authMeGET } from '@/app/api/auth/me/route';

// Supabase stub — returns mock data for users and tenant_users
function makeSupabase() {
  // tenant_users rows now carry an `id` — the auth path resolves effective
  // permissions via tenant_users.id + tenant_user_permissions (granular perms, plan 4).
  const tenantUsers = [
    { id: 'tu1', user_id: 'u1', tenant_id: 't1', role: 'owner' },
    { id: 'tu2', user_id: 'u1', tenant_id: 't2', role: 'staff' }
  ];

  function makeTable(table?: string) {
    const self = {
      _table: table,
      _userId: undefined as string | undefined,
      _tenantId: undefined as string | undefined,
      _id: undefined as string | undefined,
      select() { return self; },
      eq(_col: string, val: string) {
        if (_col === 'user_id') self._userId = val;
        if (_col === 'tenant_id') self._tenantId = val;
        if (_col === 'id' || _col === 'tenant_user_id') self._id = val;
        return self;
      },
      maybeSingle() {
        const match = tenantUsers.find(tu =>
          self._id !== undefined
            ? tu.id === self._id && tu.tenant_id === self._tenantId
            : tu.user_id === self._userId && tu.tenant_id === self._tenantId
        );
        return Promise.resolve({ data: match || null, error: null });
      },
      // Make chain thenable for array queries like .from().select().eq() without .single()
      then(resolve: (v: unknown) => void) {
        // tenant_user_permissions has no overrides in this fixture.
        if (self._table === 'tenant_user_permissions') {
          resolve({ data: [], error: null });
          return;
        }
        const matches = self._userId
          ? tenantUsers.filter(tu => tu.user_id === self._userId)
          : [];
        resolve({ data: matches, error: null });
      }
    };
    return self;
  }

  return {
    from(table: string) { return makeTable(table); },
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
    const res: Response = await authMeGET(new NextRequest('http://x/api/auth/me', { headers: { 'x-test-bypass-skip': '1' } }));
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
    const res: Response = await authMeGET(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ userId: 'u1', role: 'owner', tenantId: 't1' });
    expect(Array.isArray(json.tenantRoles)).toBe(true);
  });
});
