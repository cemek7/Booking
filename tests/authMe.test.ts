// Jest globals are available without import
import { GET as authMeGET } from '@/app/api/auth/me/route';

// Supabase stub
function makeSupabase() {
  const users = [{ id: 'u1', email: 'owner@example.com' }];
  const tenantUsers = [
    { user_id: 'u1', tenant_id: 't1', role: 'owner' },
    { user_id: 'u1', tenant_id: 't2', role: 'staff' }
  ];
  return {
    from(table: string) {
      if (table === 'users') {
        return {
          select() { return this; }, eq(_col: string, val: string) { this._email = val; return this; }, maybeSingle() { return Promise.resolve({ data: users.find(u => u.email === this._email) || null, error: null }); }
        } as any;
      }
      if (table === 'tenant_users') {
        return {
          select() { return this; }, eq(_col: string, val: string) { this._user = val; return Promise.resolve({ data: tenantUsers.filter(tu => tu.user_id === this._user), error: null }); }
        } as any;
      }
      return { select() { return this; } } as any;
    }
  } as any;
}

jest.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: () => makeSupabase(), getBrowserSupabase: () => ({}) }));

describe('auth/me API route', () => {
  it('returns 401 without user headers', async () => {
    const res: any = await authMeGET(new Request('http://x/api/auth/me'));
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json).toHaveProperty('error');
  });

  it('returns identity with highest role', async () => {
    const req = new Request('http://x/api/auth/me', { headers: { 'X-User-Id': 'u1', 'X-User-Email': 'owner@example.com' } });
    const res: any = await authMeGET(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ userId: 'u1', role: 'owner', tenantId: 't1' });
    expect(Array.isArray(json.tenantRoles)).toBe(true);
    expect(json.tenantRoles).toContain('t1:owner');
  });
});
