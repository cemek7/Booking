// Jest-style test for cookie-based auth path in invites API
import { POST as invitesPOST } from '@/app/api/tenants/[tenantId]/invites/route';

// Mock next/headers cookies() to return a Promise resolving to a cookie store
const cookiesMock = {
  get: (key: string) => {
    if (key === 'sb-access-token') return { name: key, value: 'cookie-access-token' } as any;
    return undefined as any;
  }
};
jest.mock('next/headers', () => ({ cookies: async () => cookiesMock }));

// Mock Supabase anon client to resolve user from cookie token
const mockGetUser = jest.fn();
jest.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { getUser: (...args: any[]) => mockGetUser(...args) } }) }));

// Mock server supabase minimal calls
function makeSupabase() {
  return {
    from(table: string) {
      if (table === 'tenant_users') {
        return {
          select() { return this; },
          eq() { return this; },
          single() { return Promise.resolve({ data: { role: 'manager' }, error: null }); }
        } as any;
      }
      if (table === 'tenants') {
        return {
          select() { return this; },
          eq() { return this; },
          single() { return Promise.resolve({ data: { settings: { allowedInviterRoles: ['manager'], allowInvitesFromStaffPage: true } }, error: null }); }
        } as any;
      }
      if (table === 'invites') {
        return { insert: () => Promise.resolve({ error: null }) } as any;
      }
      return { select: () => ({}) } as any;
    },
    auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) }
  } as any;
}
jest.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: () => makeSupabase() }));

describe('Invites API cookie auth path', () => {
  beforeEach(() => { mockGetUser.mockReset(); });
  it('accepts cookie-based session when no Authorization header', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: { id: 'u1' } }, error: null });
    const req = new Request('http://x/api/tenants/t1/invites', { method: 'POST', body: JSON.stringify({ email: 'a@b.com' }) });
    // @ts-ignore
    const res = await invitesPOST(req, { params: { tenantId: 't1' } });
    expect(res.status).toBe(200);
    const json = await (res as any).json();
    expect(json).toHaveProperty('ok', true);
    expect(json).toHaveProperty('url');
  });
});
